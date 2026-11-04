//! The two built-in connectors that live inside the daemon: `browser` (the extension bridge as
//! tools) and `reddit` (old.reddit.com read through the browser; it never posts).

use std::collections::BTreeMap;
use std::sync::Arc;

use serde_json::{Value, json};

use super::mcp_client::ToolOutput;
use crate::core::Core;

pub async fn call(core: &Arc<Core>, id: &str, tool: &str, args: Value) -> Result<ToolOutput, String> {
    let v = match id {
        "browser" => browser(core, tool, args).await?,
        "reddit" => reddit(core, tool, args).await?,
        _ => return Err(format!("no connector \"{id}\"")),
    };
    Ok(ToolOutput { text: v.to_string(), is_error: false })
}

async fn browser(core: &Arc<Core>, tool: &str, args: Value) -> Result<Value, String> {
    match tool {
        "open" => {
            let url = args["url"].as_str().unwrap_or("");
            if !(url.starts_with("https://") || url.starts_with("http://")) {
                return Err("`url` must start with http:// or https://".into());
            }
        }
        "read" | "links" | "scroll" | "close" => {
            if args.get("tab").is_none() {
                return Err("`tab` is missing (use the tab id that `open` returned)".into());
            }
        }
        "click" => {
            if args.get("text").is_none() && args.get("selector").is_none() {
                return Err("say what to click with `text` or `selector`".into());
            }
        }
        "type" => {
            if args["selector"].as_str().is_none() || args["text"].as_str().is_none() {
                return Err("`selector` and `text` are needed".into());
            }
        }
        _ => return Err(format!("the browser has no tool \"{tool}\"")),
    }
    core.connectors.bridge.command(tool, args).await
}

/// Argument schemas of the tools that live inside the daemon.
pub fn schema(id: &str, tool: &str) -> Value {
    let s = |d: &str| json!({ "type": "string", "description": d });
    let obj = |props: Value, req: &[&str]| json!({ "type": "object", "properties": props, "required": req });
    let tab = json!({ "type": "integer", "description": "Tab id returned by open" });
    match (id, tool) {
        ("browser", "open") => obj(json!({ "url": s("Address to open (https://…)") }), &["url"]),
        ("browser", "read") | ("browser", "links") | ("browser", "scroll") | ("browser", "close") => obj(json!({ "tab": tab }), &["tab"]),
        ("browser", "click") => {
            obj(json!({ "tab": tab, "text": s("Visible text of what to click"), "selector": s("CSS selector, if no text") }), &["tab"])
        }
        ("browser", "type") => {
            obj(json!({ "tab": tab, "selector": s("CSS selector of the field"), "text": s("Text to type") }), &["tab", "selector", "text"])
        }
        ("reddit", "search") => obj(
            json!({ "query": s("Words to search for"), "subreddit": s("Only this subreddit (without r/)"), "limit": { "type": "integer", "description": "Posts to return, default 15" } }),
            &["query"],
        ),
        ("reddit", "read_post") => obj(json!({ "url": s("A reddit.com post link") }), &["url"]),
        ("reddit", "subreddit_new") => obj(
            json!({ "subreddits": { "type": "array", "items": { "type": "string" } }, "keywords": { "type": "array", "items": { "type": "string" } } }),
            &[],
        ),
        _ => obj(json!({}), &[]),
    }
}

// ───────────── reddit ─────────────

#[derive(Debug, Clone, PartialEq)]
pub struct Post {
    pub id: String,
    pub subreddit: String,
    pub title: String,
    pub url: String,
}

fn link_list(data: &Value) -> Vec<(String, String)> {
    let arr = data.get("links").and_then(Value::as_array).or_else(|| data.as_array());
    arr.map(|a| {
        a.iter()
            .filter_map(|l| {
                let href = l["href"].as_str().or_else(|| l["url"].as_str())?;
                Some((l["text"].as_str().unwrap_or("").trim().to_string(), href.to_string()))
            })
            .collect()
    })
    .unwrap_or_default()
}

fn is_count_label(t: &str) -> bool {
    let t = t.trim().to_lowercase();
    t == "comment" || t == "comments" || t.ends_with(" comment") || t.ends_with(" comments") || t == "permalink" || t.is_empty()
}

/// Posts out of the links of a listing page: `/r/<sub>/comments/<id>/<slug>`; the title is the
/// longest link text of that post that is not "12 comments".
pub fn parse_posts(links: &Value) -> Vec<Post> {
    let mut order: Vec<String> = vec![];
    let mut by_id: BTreeMap<String, Post> = BTreeMap::new();
    for (text, href) in link_list(links) {
        let path = match url::Url::parse(&href) {
            Ok(u) if u.host_str().is_some_and(|h| h.ends_with("reddit.com")) => u.path().to_string(),
            Ok(_) => continue,
            Err(_) => href.clone(),
        };
        let seg: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
        let Some(i) = seg.iter().position(|s| *s == "comments") else { continue };
        let (Some(sub), Some(id)) = (seg.get(i.wrapping_sub(1)).filter(|_| i >= 2 && seg[i - 2] == "r"), seg.get(i + 1)) else { continue };
        let url = format!("https://www.reddit.com/r/{sub}/comments/{id}/{}", seg.get(i + 2).copied().unwrap_or(""));
        let p = by_id.entry(id.to_string()).or_insert_with(|| {
            order.push(id.to_string());
            Post { id: id.to_string(), subreddit: sub.to_string(), title: String::new(), url: url.trim_end_matches('/').to_string() }
        });
        if !is_count_label(&text) && text.chars().count() > p.title.chars().count() {
            p.title = text;
        }
    }
    order.into_iter().filter_map(|id| by_id.remove(&id)).filter(|p| !p.title.is_empty()).collect()
}

fn clean_sub(s: &str) -> Option<String> {
    let s = s.trim().trim_start_matches('/').trim_start_matches("r/").trim_start_matches('/').trim();
    (!s.is_empty() && s.len() <= 40 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')).then(|| s.to_string())
}

fn strings(v: &Value) -> Vec<String> {
    match v {
        Value::Array(a) => a.iter().filter_map(|x| x.as_str().map(|s| s.trim().to_string())).filter(|s| !s.is_empty()).collect(),
        Value::String(s) => s.split(',').map(|x| x.trim().to_string()).filter(|s| !s.is_empty()).collect(),
        _ => vec![],
    }
}

async fn with_tab<T>(core: &Arc<Core>, url: &str, f: impl AsyncFnOnce(i64) -> Result<T, String>) -> Result<T, String> {
    let b = &core.connectors.bridge;
    let opened = b.command("open", json!({ "url": url })).await?;
    let tab = opened["tab"].as_i64().ok_or("the browser did not return a tab")?;
    let r = f(tab).await;
    let _ = b.command("close", json!({ "tab": tab })).await;
    r
}

async fn listing(core: &Arc<Core>, url: &str) -> Result<Vec<Post>, String> {
    with_tab(core, url, async |tab| {
        let links = core.connectors.bridge.command("links", json!({ "tab": tab })).await?;
        Ok(parse_posts(&links))
    })
    .await
}

fn post_json(p: &Post) -> Value {
    json!({ "id": p.id, "subreddit": p.subreddit, "title": p.title, "url": p.url })
}

async fn reddit(core: &Arc<Core>, tool: &str, args: Value) -> Result<Value, String> {
    match tool {
        "search" => {
            let q = args["query"].as_str().unwrap_or("").trim().to_string();
            if q.is_empty() {
                return Err("`query` is missing".into());
            }
            let enc: String = url::form_urlencoded::byte_serialize(q.as_bytes()).collect();
            let url = match args["subreddit"].as_str().and_then(clean_sub) {
                Some(s) => format!("https://old.reddit.com/r/{s}/search?q={enc}&restrict_sr=on&sort=new"),
                None => format!("https://old.reddit.com/search?q={enc}&sort=new"),
            };
            let posts = listing(core, &url).await?;
            let limit = args["limit"].as_u64().unwrap_or(15).min(50) as usize;
            Ok(json!({ "posts": posts.iter().take(limit).map(post_json).collect::<Vec<_>>() }))
        }
        "read_post" => {
            let u = url::Url::parse(args["url"].as_str().unwrap_or("")).map_err(|_| "`url` must be a Reddit link".to_string())?;
            if !u.host_str().is_some_and(|h| h == "reddit.com" || h.ends_with(".reddit.com")) || u.scheme() != "https" {
                return Err("only reddit.com links can be read".into());
            }
            let url = format!("https://old.reddit.com{}", u.path());
            with_tab(core, &url, async |tab| core.connectors.bridge.command("read", json!({ "tab": tab })).await).await
        }
        "subreddit_new" => {
            let cfg = core.connectors.get("reddit").map(|c| c.config).unwrap_or_default();
            let scope = &args["scope"];
            let mut subs = strings(&scope["subreddits"]);
            subs.extend(strings(&args["subreddits"]));
            if subs.is_empty() {
                subs = strings(cfg.get("subreddits").unwrap_or(&Value::Null));
            }
            let mut words = strings(&scope["keywords"]);
            words.extend(strings(&args["keywords"]));
            if words.is_empty() {
                words = strings(cfg.get("keywords").unwrap_or(&Value::Null));
            }
            let subs: Vec<String> = subs.iter().filter_map(|s| clean_sub(s)).collect();
            if subs.is_empty() {
                return Err("no subreddits are set (Connectors → Reddit)".into());
            }
            let path = core.paths.root.join("connector-state").join("reddit").join("seen.json");
            let mut seen: BTreeMap<String, Vec<String>> =
                std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
            let mut events = vec![];
            let mut errors = vec![];
            for sub in subs {
                let posts = match listing(core, &format!("https://old.reddit.com/r/{sub}/new/")).await {
                    Ok(p) => p,
                    Err(e) => {
                        errors.push(format!("r/{sub}: {e}"));
                        continue;
                    }
                };
                let known = seen.entry(sub.clone()).or_default();
                let first_time = known.is_empty();
                let mut fresh: Vec<&Post> = posts.iter().filter(|p| !known.contains(&p.id)).collect();
                // The first look at a subreddit only takes the newest few, not the whole page.
                if first_time {
                    fresh.truncate(5);
                }
                for p in &posts {
                    if !known.contains(&p.id) {
                        known.push(p.id.clone());
                    }
                }
                let n = known.len();
                if n > 300 {
                    known.drain(..n - 300);
                }
                for p in fresh {
                    let lower = p.title.to_lowercase();
                    if !words.is_empty() && !words.iter().any(|w| lower.contains(&w.to_lowercase())) {
                        continue;
                    }
                    events.push(json!({
                        "type": "post", "id": format!("reddit-{}", p.id), "title": p.title, "text": p.title,
                        "url": p.url, "meta": { "subreddit": p.subreddit }
                    }));
                }
            }
            if let Some(d) = path.parent() {
                let _ = std::fs::create_dir_all(d);
            }
            let _ = crate::paths::write_private(&path, &serde_json::to_vec(&seen).unwrap_or_default());
            if events.is_empty() && !errors.is_empty() {
                return Err(errors.join("; "));
            }
            Ok(json!({ "events": events, "errors": errors }))
        }
        _ => Err(format!("Reddit has no tool \"{tool}\"")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_posts_from_listing_links() {
        let links = json!({ "links": [
            { "text": "front", "href": "https://old.reddit.com/" },
            { "text": "Is NeuralAgent any good?", "href": "https://old.reddit.com/r/rust/comments/abc123/is_neuralagent_any_good/" },
            { "text": "12 comments", "href": "https://old.reddit.com/r/rust/comments/abc123/is_neuralagent_any_good/" },
            { "text": "Second post title", "href": "/r/rust/comments/def456/second/" },
            { "text": "comment", "href": "https://old.reddit.com/r/rust/comments/zzz999/only_count/" },
            { "text": "elsewhere", "href": "https://example.com/r/rust/comments/qqq/x" }
        ]});
        let p = parse_posts(&links);
        assert_eq!(p.len(), 2);
        assert_eq!(p[0].id, "abc123");
        assert_eq!(p[0].title, "Is NeuralAgent any good?");
        assert_eq!(p[0].subreddit, "rust");
        assert_eq!(p[0].url, "https://www.reddit.com/r/rust/comments/abc123/is_neuralagent_any_good");
        assert_eq!(p[1].id, "def456");
        // A plain array works too.
        assert_eq!(parse_posts(&json!([{ "text": "T title", "url": "https://old.reddit.com/r/a/comments/1/t/" }])).len(), 1);
    }

    #[test]
    fn subreddit_names_are_cleaned() {
        assert_eq!(clean_sub(" r/rust "), Some("rust".into()));
        assert_eq!(clean_sub("/r/a_b"), Some("a_b".into()));
        assert_eq!(clean_sub("../x"), None);
        assert_eq!(strings(&json!("a, b")), vec!["a", "b"]);
    }
}
