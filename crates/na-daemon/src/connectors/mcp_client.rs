//! A minimal MCP client over newline-delimited JSON-RPC 2.0 (stdio). Generic over the byte
//! streams so tests can run it against an in-memory fake server.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use parking_lot::Mutex;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot, watch};

/// The notification a connector sends for a new event.
pub const EVENT_METHOD: &str = "notifications/neuralagent/event";

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

pub struct McpClient {
    writer: tokio::sync::Mutex<Box<dyn AsyncWrite + Send + Unpin>>,
    pending: Pending,
    next: AtomicU64,
    closed: watch::Receiver<bool>,
}

/// What a tool call returned: the text parts joined, and whether the server flagged an error.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolOutput {
    pub text: String,
    pub is_error: bool,
}

impl ToolOutput {
    /// The text as JSON when it is JSON, else the text as a string.
    pub fn json(&self) -> Value {
        serde_json::from_str(&self.text).unwrap_or_else(|_| Value::String(self.text.clone()))
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ToolInfo {
    pub name: String,
    pub description: String,
    pub schema: Value,
}

impl McpClient {
    /// Starts reading `reader`. Event notifications (their `params`) go to `events`.
    pub fn start<R, W>(reader: R, writer: W, events: mpsc::UnboundedSender<Value>) -> Arc<McpClient>
    where
        R: AsyncRead + Send + Unpin + 'static,
        W: AsyncWrite + Send + Unpin + 'static,
    {
        let pending: Pending = Default::default();
        let (closed_tx, closed) = watch::channel(false);
        let client = Arc::new(McpClient {
            writer: tokio::sync::Mutex::new(Box::new(writer)),
            pending: pending.clone(),
            next: AtomicU64::new(1),
            closed,
        });
        let me = Arc::downgrade(&client);
        tokio::spawn(async move {
            let mut lines = BufReader::new(reader).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
                let id = v.get("id").and_then(Value::as_u64);
                let method = v.get("method").and_then(Value::as_str);
                match (id, method) {
                    (Some(id), None) => {
                        let r = match v.get("error") {
                            Some(e) => Err(e["message"].as_str().unwrap_or("the connector reported an error").to_string()),
                            None => Ok(v.get("result").cloned().unwrap_or(Value::Null)),
                        };
                        if let Some(tx) = pending.lock().remove(&id) {
                            let _ = tx.send(r);
                        }
                    }
                    (None, Some(EVENT_METHOD)) => {
                        let _ = events.send(v.get("params").cloned().unwrap_or(Value::Null));
                    }
                    // A request from the server (ping): answer with an empty result.
                    (Some(id), Some(_)) => {
                        if let Some(c) = me.upgrade() {
                            let _ = c.write(&json!({ "jsonrpc": "2.0", "id": id, "result": {} })).await;
                        }
                    }
                    _ => {}
                }
            }
            let _ = closed_tx.send(true);
            for (_, tx) in pending.lock().drain() {
                let _ = tx.send(Err("the connector stopped".into()));
            }
        });
        client
    }

    async fn write(&self, v: &Value) -> Result<(), String> {
        let mut line = v.to_string();
        line.push('\n');
        let mut w = self.writer.lock().await;
        w.write_all(line.as_bytes()).await.map_err(|e| format!("cannot write to the connector: {e}"))?;
        w.flush().await.map_err(|e| format!("cannot write to the connector: {e}"))
    }

    pub async fn request(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        if self.is_closed() {
            return Err("the connector is not running".into());
        }
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().insert(id, tx);
        if let Err(e) = self.write(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })).await {
            self.pending.lock().remove(&id);
            return Err(e);
        }
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => Err("the connector stopped".into()),
            Err(_) => {
                self.pending.lock().remove(&id);
                Err(format!("the connector did not answer within {} s", timeout.as_secs()))
            }
        }
    }

    pub async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.write(&json!({ "jsonrpc": "2.0", "method": method, "params": params })).await
    }

    pub async fn initialize(&self) -> Result<Value, String> {
        let r = self
            .request(
                "initialize",
                json!({ "protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": { "name": "NeuralAgent", "version": env!("CARGO_PKG_VERSION") } }),
                Duration::from_secs(20),
            )
            .await?;
        let _ = self.notify("notifications/initialized", json!({})).await;
        Ok(r)
    }

    pub async fn list_tools(&self) -> Result<Vec<ToolInfo>, String> {
        let r = self.request("tools/list", json!({}), Duration::from_secs(20)).await?;
        Ok(r["tools"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|t| {
                        Some(ToolInfo {
                            name: t["name"].as_str()?.to_string(),
                            description: t["description"].as_str().unwrap_or_default().to_string(),
                            schema: t.get("inputSchema").cloned().unwrap_or(Value::Null),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    pub async fn call_tool(&self, name: &str, args: Value, timeout: Duration) -> Result<ToolOutput, String> {
        let r = self.request("tools/call", json!({ "name": name, "arguments": args }), timeout).await?;
        let text =
            r["content"].as_array().map(|a| a.iter().filter_map(|c| c["text"].as_str()).collect::<Vec<_>>().join("\n")).unwrap_or_default();
        Ok(ToolOutput { text, is_error: r["isError"].as_bool().unwrap_or(false) })
    }

    pub fn is_closed(&self) -> bool {
        *self.closed.borrow()
    }

    /// Resolves when the connector's output ended (the process exited).
    pub async fn wait_closed(&self) {
        let mut rx = self.closed.clone();
        let _ = rx.wait_for(|c| *c).await;
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use tokio::io::duplex;

    /// An in-memory server speaking the connector contract: echo tool, failing tool, one event.
    pub fn fake_server() -> (tokio::io::DuplexStream, tokio::io::DuplexStream) {
        let (c_out, s_in) = duplex(1 << 16);
        let (s_out, c_in) = duplex(1 << 16);
        tokio::spawn(async move {
            let mut lines = BufReader::new(s_in).lines();
            let mut out = s_out;
            while let Ok(Some(line)) = lines.next_line().await {
                let v: Value = serde_json::from_str(&line).unwrap();
                let Some(id) = v.get("id").cloned() else { continue };
                let res = match v["method"].as_str().unwrap() {
                    "initialize" => json!({ "protocolVersion": "2024-11-05", "capabilities": {}, "serverInfo": { "name": "fake" } }),
                    "tools/list" => json!({ "tools": [
                        { "name": "echo", "description": "Echo", "inputSchema": { "type": "object" } },
                        { "name": "boom", "description": "Fails" } ] }),
                    "tools/call" => match v["params"]["name"].as_str().unwrap() {
                        "echo" => {
                            // An event first, then the answer (as a real connector may do).
                            let ev = json!({ "jsonrpc": "2.0", "method": EVENT_METHOD, "params": { "type": "message", "id": "e1", "text": "hello" } });
                            out.write_all(format!("{ev}\n").as_bytes()).await.unwrap();
                            json!({ "content": [{ "type": "text", "text": v["params"]["arguments"].to_string() }] })
                        }
                        _ => json!({ "content": [{ "type": "text", "text": "it broke" }], "isError": true }),
                    },
                    _ => {
                        let e = json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "no such method" } });
                        out.write_all(format!("{e}\n").as_bytes()).await.unwrap();
                        continue;
                    }
                };
                let r = json!({ "jsonrpc": "2.0", "id": id, "result": res });
                out.write_all(format!("{r}\n").as_bytes()).await.unwrap();
            }
        });
        (c_in, c_out)
    }

    #[tokio::test]
    async fn talks_to_a_fake_connector() {
        let (r, w) = fake_server();
        let (etx, mut erx) = mpsc::unbounded_channel();
        let c = McpClient::start(r, w, etx);
        c.initialize().await.unwrap();
        let tools = c.list_tools().await.unwrap();
        assert_eq!(tools.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), ["echo", "boom"]);
        let out = c.call_tool("echo", json!({ "a": 1 }), Duration::from_secs(5)).await.unwrap();
        assert!(!out.is_error);
        assert_eq!(out.json(), json!({ "a": 1 }));
        let ev = erx.recv().await.unwrap();
        assert_eq!(ev["id"], "e1");
        let bad = c.call_tool("boom", json!({}), Duration::from_secs(5)).await.unwrap();
        assert!(bad.is_error);
        assert_eq!(bad.text, "it broke");
        assert!(c.request("nope", json!({}), Duration::from_secs(5)).await.unwrap_err().contains("no such method"));
    }

    #[tokio::test]
    async fn fails_pending_calls_when_the_server_goes_away() {
        let (c_out, s_in) = duplex(1024);
        let (s_out, c_in) = duplex(1024);
        let (etx, _erx) = mpsc::unbounded_channel();
        let c = McpClient::start(c_in, c_out, etx);
        let c2 = c.clone();
        let call = tokio::spawn(async move { c2.request("tools/list", json!({}), Duration::from_secs(5)).await });
        tokio::time::sleep(Duration::from_millis(50)).await;
        drop(s_out);
        drop(s_in);
        assert!(call.await.unwrap().is_err());
        c.wait_closed().await;
        assert!(c.request("x", json!({}), Duration::from_secs(1)).await.is_err());
    }

    #[tokio::test]
    async fn times_out() {
        let (c_out, _s_in) = duplex(1024);
        let (_s_out, c_in) = duplex(1024);
        let (etx, _erx) = mpsc::unbounded_channel();
        let c = McpClient::start(c_in, c_out, etx);
        let e = c.request("tools/list", json!({}), Duration::from_millis(100)).await.unwrap_err();
        assert!(e.contains("did not answer"));
    }
}
