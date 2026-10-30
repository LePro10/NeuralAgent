//! Chat with tool calls against the user's own model provider (BYOK): NeuralHub and other
//! OpenAI-compatible APIs, Anthropic, or a local Ollama. Streams text as it arrives.

use std::time::Instant;

use anyhow::{Context, Result, bail};
use futures_util::StreamExt;
use na_protocol::{LlmProvider, LlmSettings};
use serde_json::{Value, json};

/// One message of a provider-neutral conversation.
#[derive(Debug, Clone)]
pub enum Msg {
    User(String),
    Assistant {
        text: String,
        calls: Vec<Call>,
    },
    /// Answer to one tool call.
    Tool {
        id: String,
        content: String,
    },
}

#[derive(Debug, Clone)]
pub struct Call {
    pub id: String,
    pub name: String,
    pub args: Value,
}

pub struct Tool {
    pub name: &'static str,
    pub description: &'static str,
    pub params: Value,
}

#[derive(Debug, Default)]
pub struct Turn {
    pub text: String,
    pub calls: Vec<Call>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// Time to the first text or tool call.
    pub first_ms: Option<u64>,
}

pub struct Llm {
    http: reqwest::Client,
}

impl Default for Llm {
    fn default() -> Self {
        Self { http: reqwest::Client::builder().connect_timeout(std::time::Duration::from_secs(10)).build().unwrap_or_default() }
    }
}

/// Where a provider lives unless the user set another URL.
pub fn default_url(p: LlmProvider) -> &'static str {
    match p {
        LlmProvider::Neuralhub => "https://api.neuralhub.dev/v1",
        LlmProvider::Anthropic => "https://api.anthropic.com/v1",
        LlmProvider::Openai => "https://api.openai.com/v1",
        LlmProvider::Ollama => "http://127.0.0.1:11434/v1",
    }
}

pub fn needs_key(p: LlmProvider) -> bool {
    p != LlmProvider::Ollama
}

impl Llm {
    #[allow(clippy::too_many_arguments)]
    /// Runs one model turn; `on_text` gets each piece of text as it streams in.
    pub async fn turn(
        &self,
        cfg: &LlmSettings,
        model: &str,
        key: Option<&str>,
        system: &str,
        msgs: &[Msg],
        tools: &[Tool],
        mut on_text: impl FnMut(&str),
    ) -> Result<Turn> {
        let base = if cfg.base_url.trim().is_empty() { default_url(cfg.provider) } else { cfg.base_url.trim() }.trim_end_matches('/');
        let anthropic = cfg.provider == LlmProvider::Anthropic;
        let (url, body) = if anthropic {
            (format!("{base}/messages"), anthropic_body(model, system, msgs, tools))
        } else {
            (format!("{base}/chat/completions"), openai_body(model, system, msgs, tools))
        };
        let mut req = self.http.post(&url).json(&body);
        if let Some(k) = key {
            req = if anthropic { req.header("x-api-key", k).header("anthropic-version", "2023-06-01") } else { req.bearer_auth(k) };
        }
        let started = Instant::now();
        let res = req.send().await.with_context(|| format!("cannot reach {base}"))?;
        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            bail!("{} {}", status.as_u16(), provider_error(&text));
        }
        let mut out = Turn::default();
        let mut parts = Parts::default();
        let mut stream = res.bytes_stream();
        let mut buf = String::new();
        while let Some(chunk) = stream.next().await {
            buf.push_str(&String::from_utf8_lossy(&chunk?));
            while let Some(i) = buf.find('\n') {
                let line = buf[..i].trim().to_string();
                buf.drain(..=i);
                let Some(data) = line.strip_prefix("data:").map(str::trim) else { continue };
                if data == "[DONE]" {
                    continue;
                }
                let Ok(ev) = serde_json::from_str::<Value>(data) else { continue };
                let text = if anthropic { parts.anthropic(&ev, &mut out) } else { parts.openai(&ev, &mut out) };
                if (text.is_some() || !parts.calls.is_empty()) && out.first_ms.is_none() {
                    out.first_ms = Some(started.elapsed().as_millis() as u64);
                }
                if let Some(t) = text {
                    out.text.push_str(&t);
                    on_text(&t);
                }
            }
        }
        out.calls = parts.finish();
        Ok(out)
    }
}

/// The readable part of a provider's error body.
fn provider_error(body: &str) -> String {
    let v: Value = serde_json::from_str(body).unwrap_or_default();
    let msg = v["error"]["message"].as_str().or_else(|| v["error"].as_str()).or_else(|| v["message"].as_str());
    msg.map(str::to_string).unwrap_or_else(|| body.chars().take(200).collect())
}

/// Tool calls arrive in pieces; collected here in order.
#[derive(Default)]
struct Parts {
    calls: Vec<(String, String, String)>,
    /// Anthropic: content block index → position in `calls`.
    blocks: std::collections::HashMap<u64, usize>,
}

impl Parts {
    fn openai(&mut self, ev: &Value, out: &mut Turn) -> Option<String> {
        if let Some(u) = ev.get("usage").filter(|u| u.is_object()) {
            out.input_tokens = u["prompt_tokens"].as_u64().unwrap_or(0);
            out.output_tokens = u["completion_tokens"].as_u64().unwrap_or(0);
        }
        let d = &ev["choices"][0]["delta"];
        if let Some(tc) = d["tool_calls"].as_array() {
            for c in tc {
                let i = c["index"].as_u64().unwrap_or(0) as usize;
                while self.calls.len() <= i {
                    self.calls.push(Default::default());
                }
                let slot = &mut self.calls[i];
                if let Some(id) = c["id"].as_str() {
                    slot.0 = id.to_string();
                }
                if let Some(n) = c["function"]["name"].as_str() {
                    slot.1.push_str(n);
                }
                if let Some(a) = c["function"]["arguments"].as_str() {
                    slot.2.push_str(a);
                }
            }
        }
        d["content"].as_str().filter(|s| !s.is_empty()).map(str::to_string)
    }

    fn anthropic(&mut self, ev: &Value, out: &mut Turn) -> Option<String> {
        match ev["type"].as_str()? {
            "message_start" => {
                out.input_tokens = ev["message"]["usage"]["input_tokens"].as_u64().unwrap_or(0);
                None
            }
            "message_delta" => {
                out.output_tokens = ev["usage"]["output_tokens"].as_u64().unwrap_or(out.output_tokens);
                None
            }
            "content_block_start" if ev["content_block"]["type"] == "tool_use" => {
                let b = &ev["content_block"];
                self.blocks.insert(ev["index"].as_u64().unwrap_or(0), self.calls.len());
                self.calls.push((b["id"].as_str().unwrap_or("").into(), b["name"].as_str().unwrap_or("").into(), String::new()));
                None
            }
            "content_block_delta" => {
                let d = &ev["delta"];
                match d["type"].as_str()? {
                    "text_delta" => d["text"].as_str().map(str::to_string),
                    "input_json_delta" => {
                        let i = *self.blocks.get(&ev["index"].as_u64().unwrap_or(0))?;
                        self.calls[i].2.push_str(d["partial_json"].as_str().unwrap_or(""));
                        None
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }

    fn finish(self) -> Vec<Call> {
        self.calls
            .into_iter()
            .filter(|c| !c.1.is_empty())
            .enumerate()
            .map(|(i, (id, name, args))| Call {
                id: if id.is_empty() { format!("call_{i}") } else { id },
                name,
                // A cut-off argument string becomes {}; the tool then says what is missing.
                args: serde_json::from_str(if args.trim().is_empty() { "{}" } else { &args }).unwrap_or(json!({})),
            })
            .collect()
    }
}

fn openai_body(model: &str, system: &str, msgs: &[Msg], tools: &[Tool]) -> Value {
    let mut m = vec![json!({ "role": "system", "content": system })];
    for x in msgs {
        m.push(match x {
            Msg::User(t) => json!({ "role": "user", "content": t }),
            Msg::Assistant { text, calls } if calls.is_empty() => json!({ "role": "assistant", "content": text }),
            Msg::Assistant { text, calls } => json!({
                "role": "assistant",
                "content": if text.is_empty() { Value::Null } else { json!(text) },
                "tool_calls": calls.iter().map(|c| json!({ "id": c.id, "type": "function", "function": { "name": c.name, "arguments": c.args.to_string() } })).collect::<Vec<_>>(),
            }),
            Msg::Tool { id, content } => json!({ "role": "tool", "tool_call_id": id, "content": content }),
        });
    }
    let mut body =
        json!({ "model": model, "stream": true, "stream_options": { "include_usage": true }, "max_tokens": 1024, "messages": m });
    if !tools.is_empty() {
        body["tools"] = tools
            .iter()
            .map(|t| json!({ "type": "function", "function": { "name": t.name, "description": t.description, "parameters": t.params } }))
            .collect();
    }
    body
}

fn anthropic_body(model: &str, system: &str, msgs: &[Msg], tools: &[Tool]) -> Value {
    // Anthropic wants tool results as user turns and consecutive roles merged.
    let mut m: Vec<Value> = vec![];
    let mut push = |role: &str, block: Value| match m.last_mut() {
        Some(last) if last["role"] == role => last["content"].as_array_mut().unwrap().push(block),
        _ => m.push(json!({ "role": role, "content": [block] })),
    };
    for x in msgs {
        match x {
            Msg::User(t) => push("user", json!({ "type": "text", "text": t })),
            Msg::Assistant { text, calls } => {
                if !text.is_empty() {
                    push("assistant", json!({ "type": "text", "text": text }));
                }
                for c in calls {
                    push("assistant", json!({ "type": "tool_use", "id": c.id, "name": c.name, "input": c.args }));
                }
            }
            Msg::Tool { id, content } => push("user", json!({ "type": "tool_result", "tool_use_id": id, "content": content })),
        }
    }
    let mut body = json!({ "model": model, "stream": true, "max_tokens": 1024, "system": system, "messages": m });
    if !tools.is_empty() {
        body["tools"] = tools.iter().map(|t| json!({ "name": t.name, "description": t.description, "input_schema": t.params })).collect();
    }
    body
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openai_tool_calls_are_assembled_from_pieces() {
        let mut p = Parts::default();
        let mut t = Turn::default();
        for ev in [
            json!({"choices":[{"delta":{"content":"On it."}}]}),
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"start_agent","arguments":"{\"fol"}}]}}]}),
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"der\":\"Japan Map\"}"}}]}}]}),
            json!({"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5}}),
        ] {
            p.openai(&ev, &mut t);
        }
        let calls = p.finish();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "start_agent");
        assert_eq!(calls[0].args["folder"], "Japan Map");
        assert_eq!((t.input_tokens, t.output_tokens), (10, 5));
    }

    #[test]
    fn anthropic_tool_calls_and_text() {
        let mut p = Parts::default();
        let mut t = Turn::default();
        let mut text = String::new();
        for ev in [
            json!({"type":"message_start","message":{"usage":{"input_tokens":7}}}),
            json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Sure."}}),
            json!({"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t1","name":"list_agents"}}),
            json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{}"}}),
            json!({"type":"message_delta","usage":{"output_tokens":4}}),
        ] {
            if let Some(s) = p.anthropic(&ev, &mut t) {
                text.push_str(&s);
            }
        }
        assert_eq!(text, "Sure.");
        let calls = p.finish();
        assert_eq!((calls[0].id.as_str(), calls[0].name.as_str()), ("t1", "list_agents"));
        assert_eq!((t.input_tokens, t.output_tokens), (7, 4));
    }

    #[test]
    fn anthropic_merges_tool_results_into_one_user_turn() {
        let call = |id: &str| Call { id: id.into(), name: "x".into(), args: json!({}) };
        let msgs = vec![
            Msg::User("hi".into()),
            Msg::Assistant { text: "".into(), calls: vec![call("a"), call("b")] },
            Msg::Tool { id: "a".into(), content: "1".into() },
            Msg::Tool { id: "b".into(), content: "2".into() },
        ];
        let b = anthropic_body("m", "s", &msgs, &[]);
        let m = b["messages"].as_array().unwrap();
        assert_eq!(m.len(), 3);
        assert_eq!(m[2]["content"].as_array().unwrap().len(), 2);
    }
}
