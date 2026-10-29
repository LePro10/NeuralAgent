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
}
