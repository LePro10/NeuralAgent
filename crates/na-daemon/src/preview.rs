//! Finds the address a dev server prints ("Local: http://localhost:5173/") in terminal output,
//! so the app can offer a preview of what the agent is building.

/// The last local web address in `chunk`, with `0.0.0.0` / `[::]` turned into `localhost`.
pub fn find_url(chunk: &[u8]) -> Option<String> {
    let text = strip_ansi(chunk);
    let mut found = None;
    let mut rest = text.as_str();
    while let Some(i) = rest.find("http") {
        let tail = &rest[i..];
        let end =
            tail.find(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>' | '`' | ')' | ']' | ',')).unwrap_or(tail.len());
        if let Some(u) = local(&tail[..end]) {
            found = Some(u);
        }
        rest = &tail[4..];
    }
    found
}

fn local(url: &str) -> Option<String> {
    let (scheme, after) = url.split_once("://")?;
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let (host_port, path) = after.find('/').map_or((after, ""), |i| (&after[..i], &after[i..]));
    let (host, port) = host_port.rsplit_once(':')?;
    if port.is_empty() || !port.chars().all(|c| c.is_ascii_digit()) || port.len() > 5 {
        return None;
    }
    let host = match host {
        "localhost" | "127.0.0.1" | "[::1]" => host,
        "0.0.0.0" | "[::]" => "localhost",
        _ => return None,
    };
    let path = path.trim_end_matches(['.', ':', ';']);
    Some(format!("{scheme}://{host}:{port}{}", if path.is_empty() { "/" } else { path }))
}

/// Drops escape sequences (colours, cursor moves, OSC titles and links) and keeps the text.
fn strip_ansi(b: &[u8]) -> String {
    let s = String::from_utf8_lossy(b);
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c != '\x1b' {
            out.push(c);
            continue;
        }
        match it.next() {
            // CSI: parameters, then one final byte
            Some('[') => {
                for c in it.by_ref() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
            }
            // OSC: until BEL or ST
            Some(']') => {
                while let Some(c) = it.next() {
                    if c == '\x07' || (c == '\x1b' && it.peek() == Some(&'\\')) {
                        if c == '\x1b' {
                            it.next();
                        }
                        break;
                    }
                }
            }
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::find_url;

    #[test]
    fn finds_dev_server_addresses() {
        // Vite colours the port
        let vite = b"  \x1b[32m\xe2\x9e\x9c\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m\r\n";
        assert_eq!(find_url(vite).as_deref(), Some("http://localhost:5173/"));
        assert_eq!(find_url(b"- Local:        http://localhost:3000\n").as_deref(), Some("http://localhost:3000/"));
        assert_eq!(find_url(b"Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/) ...").as_deref(), Some("http://localhost:8000/"));
        assert_eq!(find_url(b"ready at http://127.0.0.1:8080/app.").as_deref(), Some("http://127.0.0.1:8080/app"));
        assert_eq!(find_url(b"see https://example.com:443/docs and http://localhost/"), None);
        assert_eq!(find_url(b"no url here"), None);
    }
}
