//! Text helpers: normalisation for comparisons and word error rate.

/// Lower case, punctuation removed, whitespace collapsed ("Hallo, Welt!" → "hallo welt").
pub fn normalize(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_alphanumeric() || c.is_whitespace() || c == '\'' { c.to_lowercase().next().unwrap_or(c) } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Word error rate of `hyp` against `reference` (both normalised first), as a fraction.
pub fn wer(reference: &str, hyp: &str) -> f32 {
    let r: Vec<String> = normalize(reference).split(' ').filter(|w| !w.is_empty()).map(String::from).collect();
    let h: Vec<String> = normalize(hyp).split(' ').filter(|w| !w.is_empty()).map(String::from).collect();
    if r.is_empty() {
        return if h.is_empty() { 0.0 } else { 1.0 };
    }
    let mut prev: Vec<usize> = (0..=h.len()).collect();
    for (i, rw) in r.iter().enumerate() {
        let mut cur = vec![i + 1; h.len() + 1];
        for (j, hw) in h.iter().enumerate() {
            cur[j + 1] = (prev[j] + usize::from(rw != hw)).min(prev[j + 1] + 1).min(cur[j] + 1);
        }
        prev = cur;
    }
    prev[h.len()] as f32 / r.len() as f32
}

/// "Hey Neural, start Claude" → "start Claude": the wake word at the start of an utterance (a
/// call started by it hears it again), also misheard ("Hi Noral", "hey nora"), also after a
/// word or two that came before it. Text without it is returned unchanged.
pub fn strip_wake(text: &str) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    let word = |i: usize| words.get(i).map(|w| normalize(w)).unwrap_or_default();
    let neural = |w: &str| ["neural", "noral", "nural", "neuro", "neurel", "neral", "mural"].contains(&w);
    let hey = |w: &str| ["hey", "hi", "hei", "hai", "high", "he", "ey", "hej"].contains(&w);
    let cut = (0..3.min(words.len())).find_map(|i| {
        let (a, b) = (word(i), word(i + 1));
        if hey(&a) && (neural(&b) || ["neu", "nor", "nur", "noel"].iter().any(|p| b.starts_with(p))) {
            Some(i + 2)
        } else if i == 0 && neural(&a) {
            Some(1)
        } else {
            None
        }
    });
    match cut {
        Some(n) => words[n.min(words.len())..].join(" ").trim_start_matches([',', '.', '!', '?', ' ', '-']).to_string(),
        None => text.trim().to_string(),
    }
}

/// The caller paused but did not finish: the last word is one a sentence does not end on
/// ("und", "and", "ähm"), or it ends with a comma or a dash. The call waits a moment longer for
/// the rest instead of answering half a thought.
pub fn unfinished(text: &str) -> bool {
    let t = text.trim_end();
    if t.ends_with([',', '-', '\u{2026}', ':']) || t.ends_with("...") {
        return true;
    }
    const OPEN: &[&str] = &[
        "und", "oder", "aber", "also", "dann", "weil", "dass", "wenn", "ob", "mit", "für", "zu", "von", "der", "die", "das", "den", "dem", "ein",
        "eine", "einen", "äh", "ähm", "öhm", "ehm", "hm", "and", "or", "but", "so", "because", "that", "the", "a", "an", "to", "with", "for",
        "of", "um", "uh", "uhm", "erm",
    ];
    normalize(t).rsplit(' ').next().is_some_and(|w| OPEN.contains(&w))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wer_counts_edits() {
        assert_eq!(normalize("Hallo, Welt!  Öffne"), "hallo welt öffne");
        assert_eq!(wer("a b c d", "a b c d"), 0.0);
        assert_eq!(wer("a b c d", "a x c"), 0.5);
        assert_eq!(wer("Stopp alle Agents.", "stopp alle agents"), 0.0);
    }

    #[test]
    fn strips_the_wake_word() {
        assert_eq!(strip_wake("Hey Neural, start Claude."), "start Claude.");
        assert_eq!(strip_wake("Hi Noral. Was machen meine Agents?"), "Was machen meine Agents?");
        assert_eq!(strip_wake("Hey Neural"), "");
        assert_eq!(strip_wake("Neural, read me the news"), "read me the news");
        assert_eq!(strip_wake("Okay, hey Neural, stop all agents"), "stop all agents");
        assert_eq!(strip_wake("Angeral, read me"), "Angeral, read me");
        assert_eq!(strip_wake("Hey, what is my plan today"), "Hey, what is my plan today");
        assert_eq!(strip_wake("Mach weiter mit dem Plan"), "Mach weiter mit dem Plan");
        assert_eq!(strip_wake("Hey, now start the build"), "Hey, now start the build");
    }

    #[test]
    fn hears_an_unfinished_sentence() {
        assert!(unfinished("Start Claude in NeuralAgent und"));
        assert!(unfinished("Look at the build, and."));
        assert!(unfinished("Ich möchte, ähm."));
        assert!(unfinished("Erstens,"));
        assert!(!unfinished("Start Claude in NeuralAgent."));
        assert!(!unfinished("Was machen meine Agents?"));
        assert!(!unfinished(""));
    }
}
