//! Claude view: the less common transcript shapes, kept out of `claude_view::parse_line`.
//! Tool result details (`toolUseResult`), background task notices, `!` shell input, pasted text,
//! hook output, API errors, the message queue and todo lists.

use na_protocol::*;
use serde_json::Value;

/// Longest stdout/stderr kept in tool meta (the tool result text has the combined output too).
const MAX_STREAM: usize = 6000;
/// Diff lines kept per tool result.
const MAX_PATCH_LINES: usize = 600;

fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let head: String = s.chars().take(max).collect();
    format!("{head}\n… ({} more characters)", s.chars().count() - max)
}

fn s(v: &Value) -> Option<String> {
    v.as_str().filter(|s| !s.is_empty()).map(str::to_string)
}

fn u32_of(v: &Value) -> Option<u32> {
    v.as_u64().map(|n| n.min(u32::MAX as u64) as u32)
}

pub fn between<'a>(s: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let a = s.find(open)? + open.len();
    let b = s[a..].find(close)? + a;
    Some(&s[a..b])
}

/// `toolUseResult` of a user line → the details the UI shows on the tool card.
pub fn tool_meta(r: &Value) -> Option<CvToolMeta> {
    let o = r.as_object()?;
    let mut m = CvToolMeta {
        agent_id: s(&r["agentId"]),
        status: s(&r["status"]),
        agent_type: s(&r["agentType"]),
        background_task_id: s(&r["backgroundTaskId"]).or_else(|| s(&r["taskId"])),
        interrupted: r["interrupted"].as_bool().filter(|b| *b),
        return_code: s(&r["returnCodeInterpretation"]),
        is_image: r["isImage"].as_bool().filter(|b| *b),
        full_output: s(&r["persistedOutputPath"]),
        user_modified: r["userModified"].as_bool().filter(|b| *b),
        duration_ms: r["totalDurationMs"].as_u64().or(r["durationMs"].as_u64()),
        tool_count: u32_of(&r["totalToolUseCount"]),
        tokens: r["totalTokens"].as_u64(),
        model: s(&r["resolvedModel"]),
        count: u32_of(&r["numFiles"]).or(u32_of(&r["numMatches"])).or(u32_of(&r["numLines"])),
        ..Default::default()
    };
    // stdout/stderr apart only when there is an error stream (the result text has both together).
    if let Some(err) = s(&r["stderr"]).filter(|e| !e.trim().is_empty()) {
        m.stderr = Some(clip(&err, MAX_STREAM));
        m.stdout = s(&r["stdout"]).map(|o| clip(&o, MAX_STREAM));
    }
    if let Some(t) = r["type"].as_str().filter(|t| matches!(*t, "create" | "update"))
        && o.contains_key("filePath")
    {
        m.write = Some(t.to_string());
    }
    let mut left = MAX_PATCH_LINES;
    for h in r["structuredPatch"].as_array().into_iter().flatten() {
        if left == 0 {
            break;
        }
        let lines: Vec<String> =
            h["lines"].as_array().into_iter().flatten().filter_map(|l| l.as_str()).take(left).map(|l| clip(l, 2000)).collect();
        left -= lines.len();
        m.patch.push(CvHunk {
            old_start: u32_of(&h["oldStart"]).unwrap_or(0),
            old_lines: u32_of(&h["oldLines"]).unwrap_or(0),
            new_start: u32_of(&h["newStart"]).unwrap_or(0),
            new_lines: u32_of(&h["newLines"]).unwrap_or(0),
            lines,
        });
    }
    if let Some(a) = r["answers"].as_object().filter(|a| !a.is_empty()) {
        m.answers = Some(Value::Object(a.clone()));
    }
    for f in r["files"].as_array().into_iter().flatten() {
        if let Some(p) = f.as_str().or(f["path"].as_str()).or(f["filePath"].as_str()) {
            m.files.push(p.to_string());
        }
    }
    (m != CvToolMeta::default()).then_some(m)
}

/// The text of a sync agent's final report (`toolUseResult.content[].text`).
pub fn agent_result_text(r: &Value) -> Option<String> {
    let t: Vec<&str> = r["content"].as_array()?.iter().filter_map(|b| b["text"].as_str()).collect();
    (!t.is_empty()).then(|| t.join("\n"))
}

/// Kind of a background task from its id: shells are `b…` (9 characters), agents `a…`.
pub fn task_kind(id: &str) -> &'static str {
    if id.starts_with('b') && id.len() <= 10 { "bash" } else { "agent" }
}

/// `<task-notification>` (a background agent or shell finished) → a `task_note` block.
pub fn task_notification(text: &str) -> Option<CvBlock> {
    let body = between(text, "<task-notification>", "</task-notification>")?;
    let tag = |t: &str| between(body, &format!("<{t}>"), &format!("</{t}>")).map(|x| x.trim().to_string()).filter(|x| !x.is_empty());
    let task_id = tag("task-id")?;
    let num = |t: &str| tag(t).and_then(|x| x.parse::<u64>().ok());
    // The summary is the text after <summary> up to the next tag (it can hold a <note>).
    let summary = tag("summary").map(|x| match x.find("<note>") {
        Some(i) => x[..i].trim().to_string(),
        None => x,
    });
    let kind = tag("task-type")
        .map(|t| if t.contains("bash") || t.contains("shell") { "bash".into() } else { t })
        .unwrap_or_else(|| task_kind(&task_id).into());
    Some(CvBlock::TaskNote {
        kind,
        tool_use_id: tag("tool-use-id"),
        status: tag("status").unwrap_or_else(|| "completed".into()),
        summary: summary.unwrap_or_default(),
        result: tag("result").map(|r| clip(&r, 12_000)).unwrap_or_default(),
        tokens: num("subagent_tokens").or(num("total_tokens")),
        tool_count: num("tool_uses").map(|n| n.min(u32::MAX as u64) as u32),
        duration_ms: num("duration_ms"),
        output_file: tag("output-file"),
        task_id,
    })
}

/// `!` shell mode: `<bash-input>cmd</bash-input>` (its own line) and the output line after it.
pub enum ShellLine {
    Input(String),
    Output { stdout: Option<String>, stderr: Option<String> },
}

pub fn shell_line(text: &str) -> Option<ShellLine> {
    if let Some(cmd) = between(text, "<bash-input>", "</bash-input>") {
        return Some(ShellLine::Input(cmd.trim().to_string()));
    }
    let out = between(text, "<bash-stdout>", "</bash-stdout>");
    let err = between(text, "<bash-stderr>", "</bash-stderr>");
    if out.is_none() && err.is_none() {
        return None;
    }
    let keep = |x: Option<&str>| x.map(|t| clip(t.trim_end(), 12_000)).filter(|t| !t.trim().is_empty());
    Some(ShellLine::Output { stdout: keep(out), stderr: keep(err) })
}

/// A prompt with `<pasted_content id="…">…</pasted_content id="…">` parts → text and pasted blocks.
/// `None` when nothing was pasted.
pub fn split_pasted(text: &str) -> Option<Vec<CvBlock>> {
    if !text.contains("<pasted_content") {
        return None;
    }
    let mut blocks = vec![];
    let mut rest = text;
    while let Some(a) = rest.find("<pasted_content") {
        let Some(open_end) = rest[a..].find('>').map(|i| a + i + 1) else { break };
        let Some(close) = rest[open_end..].find("</pasted_content").map(|i| open_end + i) else { break };
        let close_end = rest[close..].find('>').map(|i| close + i + 1).unwrap_or(rest.len());
        let before = rest[..a].trim();
        if !before.is_empty() {
            blocks.push(CvBlock::Text { text: before.to_string() });
        }
        let body = rest[open_end..close].trim_matches('\n');
        blocks.push(CvBlock::Pasted { text: clip(body, 30_000), lines: body.lines().count().max(1) as u32 });
        rest = &rest[close_end..];
    }
    let tail = rest.trim();
    if !tail.is_empty() {
        blocks.push(CvBlock::Text { text: tail.to_string() });
    }
    (!blocks.is_empty()).then_some(blocks)
}

/// Hook output worth showing: messages a hook printed, cancelled hooks, errors.
pub fn hook_attachment(a: &Value) -> Option<CvBlock> {
    let ty = a["type"].as_str()?;
    if !ty.starts_with("hook_") || matches!(ty, "hook_success" | "hook_additional_context") {
        return None;
    }
    let event = s(&a["hookEvent"]).unwrap_or_default();
    let name = s(&a["hookName"]).unwrap_or_default();
    let text = match ty {
        "hook_cancelled" => format!("Hook cancelled: {}", if name.is_empty() { &event } else { &name }),
        _ => s(&a["content"])
            .or_else(|| s(&a["blockingError"]["blockingError"]))
            .or_else(|| s(&a["blockingError"]))
            .or_else(|| s(&a["stderr"]))
            .or_else(|| s(&a["message"]))?,
    };
    Some(CvBlock::Hook { event, text: clip(text.trim(), 4000), error: ty.contains("error") || ty.contains("blocking") })
}

/// `system.stop_hook_summary`: only interesting with errors or when a hook kept Claude going.
pub fn stop_hook_summary(v: &Value) -> Option<CvBlock> {
    let errors: Vec<String> = v["hookErrors"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|e| e.as_str().map(str::to_string).or_else(|| s(&e["error"])).or_else(|| s(&e["message"])))
        .collect();
    let prevented = v["preventedContinuation"].as_bool() == Some(true);
    if errors.is_empty() && !prevented {
        return None;
    }
    let text =
        if errors.is_empty() { s(&v["stopReason"]).unwrap_or_else(|| "A Stop hook blocked the stop".into()) } else { errors.join("\n") };
    Some(CvBlock::Hook { event: "Stop".into(), text: clip(&text, 4000), error: !errors.is_empty() })
}

/// An assistant line the CLI wrote itself for a failed request (rate limit, auth, server error).
pub fn api_error(v: &Value) -> Option<CvBlock> {
    if v["isApiErrorMessage"].as_bool() != Some(true) {
        return None;
    }
    let text: Vec<&str> = v["message"]["content"].as_array().into_iter().flatten().filter_map(|b| b["text"].as_str()).collect();
    let text = if text.is_empty() { "The request failed".to_string() } else { text.join("\n") };
    Some(CvBlock::Error { text: clip(&text, 4000), code: s(&v["error"]), status: u32_of(&v["apiErrorStatus"]) })
}

/// A refused answer (`stop_reason: refusal`) → an error block after the text.
pub fn refusal(m: &Value) -> Option<CvBlock> {
    if m["stop_reason"] != "refusal" {
        return None;
    }
    let text = s(&m["stop_details"]["explanation"]).unwrap_or_else(|| "Claude declined to continue this request.".into());
    Some(CvBlock::Error { text, code: Some("refusal".into()), status: None })
}

/// What a `queue-operation` line does to the queue of typed-ahead messages.
#[derive(Debug, PartialEq)]
pub enum QueueOp {
    Add(String),
    /// Delivered or removed: the oldest entry with this text (or the oldest one).
    Take(Option<String>),
}

pub fn queue_op(v: &Value) -> Option<QueueOp> {
    let content = v["content"].as_str().map(str::to_string);
    // Background task notices are queued too; they are not something the user typed.
    if content.as_deref().is_some_and(|c| c.trim_start().starts_with('<')) {
        return None;
    }
    match v["operation"].as_str()? {
        "enqueue" => content.filter(|c| !c.trim().is_empty()).map(QueueOp::Add),
        "dequeue" | "remove" | "popAll" => Some(QueueOp::Take(content)),
        _ => None,
    }
}

/// Changes to the todo list from one tool call.
#[derive(Debug, PartialEq)]
pub enum TodoOp {
    /// TodoWrite: the whole list.
    Replace(Vec<CvTodo>),
    /// TaskCreate: a new entry; its id comes with the result (keyed by the tool call).
    Create { tool_use_id: String, todo: CvTodo },
    /// TaskCreate result: the id of the entry created by that tool call.
    Created { tool_use_id: String, id: String },
    /// TaskUpdate.
    Update { id: String, status: Option<String>, content: Option<String>, active: Option<String> },
}

pub fn todo_from_tool_use(name: &str, id: &str, input: &Value) -> Option<TodoOp> {
    match name {
        "TodoWrite" => Some(TodoOp::Replace(
            input["todos"]
                .as_array()?
                .iter()
                .map(|t| CvTodo {
                    id: s(&t["id"]),
                    content: s(&t["content"]).unwrap_or_default(),
                    active: s(&t["activeForm"]),
                    status: s(&t["status"]).unwrap_or_else(|| "pending".into()),
                })
                .collect(),
        )),
        "TaskCreate" => Some(TodoOp::Create {
            tool_use_id: id.to_string(),
            todo: CvTodo {
                id: None,
                content: s(&input["subject"]).or_else(|| s(&input["description"])).unwrap_or_default(),
                active: s(&input["activeForm"]),
                status: "pending".into(),
            },
        }),
        "TaskUpdate" => Some(TodoOp::Update {
            id: s(&input["taskId"]).or_else(|| input["taskId"].as_u64().map(|n| n.to_string()))?,
            status: s(&input["status"]),
            content: s(&input["subject"]),
            active: s(&input["activeForm"]),
        }),
        _ => None,
    }
}

pub fn todo_created(tool_use_id: &str, r: &Value) -> Option<TodoOp> {
    let id = s(&r["task"]["id"]).or_else(|| r["task"]["id"].as_u64().map(|n| n.to_string()))?;
    Some(TodoOp::Created { tool_use_id: tool_use_id.to_string(), id })
}

pub fn apply_todo(todos: &mut Vec<CvTodo>, pending: &mut Vec<(String, usize)>, op: TodoOp) {
    match op {
        TodoOp::Replace(list) => {
            *todos = list;
            pending.clear();
        }
        TodoOp::Create { tool_use_id, todo } => {
            pending.push((tool_use_id, todos.len()));
            todos.push(todo);
        }
        TodoOp::Created { tool_use_id, id } => {
            if let Some(&(_, ix)) = pending.iter().find(|(t, _)| *t == tool_use_id)
                && let Some(t) = todos.get_mut(ix)
            {
                t.id = Some(id);
            }
        }
        TodoOp::Update { id, status, content, active } => {
            if status.as_deref() == Some("deleted") {
                todos.retain(|t| t.id.as_deref() != Some(&id));
                pending.clear();
                return;
            }
            if let Some(t) = todos.iter_mut().find(|t| t.id.as_deref() == Some(&id)) {
                if let Some(s) = status {
                    t.status = s;
                }
                if let Some(c) = content {
                    t.content = c;
                }
                if active.is_some() {
                    t.active = active;
                }
            }
        }
    }
    if todos.len() > 200 {
        todos.drain(..todos.len() - 200);
        pending.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn edit_and_bash_results_have_details() {
        let m = tool_meta(&json!({
            "filePath": "/r/a.rs", "oldString": "x", "newString": "y", "userModified": false,
            "structuredPatch": [{ "oldStart": 3, "oldLines": 1, "newStart": 3, "newLines": 1, "lines": ["-x", "+y"] }]
        }))
        .unwrap();
        assert_eq!(m.patch.len(), 1);
        assert_eq!(m.patch[0].old_start, 3);
        assert_eq!(m.patch[0].lines, vec!["-x", "+y"]);
        assert_eq!(m.write, None);
        let w = tool_meta(&json!({ "type": "create", "filePath": "/r/b.rs", "content": "hi", "structuredPatch": [] })).unwrap();
        assert_eq!(w.write.as_deref(), Some("create"));
        let b = tool_meta(&json!({ "stdout": "ok", "stderr": "", "interrupted": false, "isImage": false })).unwrap_or_default();
        assert_eq!(b, CvToolMeta::default());
        let b = tool_meta(&json!({ "stdout": "ok", "stderr": "warn", "interrupted": true, "backgroundTaskId": "b1234", "persistedOutputPath": "/t/o.txt" })).unwrap();
        assert_eq!((b.stdout.as_deref(), b.stderr.as_deref(), b.interrupted), (Some("ok"), Some("warn"), Some(true)));
        assert_eq!(b.background_task_id.as_deref(), Some("b1234"));
        assert_eq!(b.full_output.as_deref(), Some("/t/o.txt"));
        assert!(tool_meta(&json!("Error: no")).is_none());
    }

    #[test]
    fn agent_results_and_questions() {
        let a = tool_meta(
            &json!({ "isAsync": true, "status": "async_launched", "agentId": "a01", "resolvedModel": "m", "outputFile": "/t/a01.output" }),
        )
        .unwrap();
        assert_eq!((a.agent_id.as_deref(), a.status.as_deref(), a.model.as_deref()), (Some("a01"), Some("async_launched"), Some("m")));
        let s = json!({ "status": "completed", "agentId": "a02", "agentType": "Explore", "content": [{ "type": "text", "text": "found it" }],
            "totalDurationMs": 5000, "totalTokens": 900, "totalToolUseCount": 4 });
        let m = tool_meta(&s).unwrap();
        assert_eq!((m.duration_ms, m.tokens, m.tool_count), (Some(5000), Some(900), Some(4)));
        assert_eq!(agent_result_text(&s).as_deref(), Some("found it"));
        let q = tool_meta(&json!({ "questions": [], "answers": { "Which?": "A" } })).unwrap();
        assert_eq!(q.answers, Some(json!({ "Which?": "A" })));
    }

    #[test]
    fn task_notifications() {
        let t = "<task-notification>\n<task-id>a0123456789abcdef</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<output-file>/t/x.output</output-file>\n<status>completed</status>\n<summary>Agent \"Look\" finished\n<note>read it</note></summary>\n<result>All good</result>\n<usage><subagent_tokens>120</subagent_tokens><tool_uses>3</tool_uses><duration_ms>4000</duration_ms></usage>\n</task-notification>";
        let CvBlock::TaskNote { task_id, tool_use_id, status, summary, result, kind, tokens, tool_count, duration_ms, output_file } =
            task_notification(t).unwrap()
        else {
            panic!()
        };
        assert_eq!(task_id, "a0123456789abcdef");
        assert_eq!(tool_use_id.as_deref(), Some("toolu_1"));
        assert_eq!(
            (status.as_str(), summary.as_str(), result.as_str(), kind.as_str()),
            ("completed", "Agent \"Look\" finished", "All good", "agent")
        );
        assert_eq!((tokens, tool_count, duration_ms), (Some(120), Some(3), Some(4000)));
        assert_eq!(output_file.as_deref(), Some("/t/x.output"));
        let b = task_notification(
            "<task-notification><task-id>bsze43f5n</task-id><status>failed</status><summary>exit 1</summary></task-notification>",
        )
        .unwrap();
        assert!(matches!(b, CvBlock::TaskNote { kind, status, .. } if kind == "bash" && status == "failed"));
        assert!(task_notification("hello").is_none());
    }

    #[test]
    fn shell_and_pasted() {
        assert!(matches!(shell_line("<bash-input>ls -la</bash-input>"), Some(ShellLine::Input(c)) if c == "ls -la"));
        let Some(ShellLine::Output { stdout, stderr }) = shell_line("<bash-stdout>a\nb\n</bash-stdout><bash-stderr></bash-stderr>") else {
            panic!()
        };
        assert_eq!((stdout.as_deref(), stderr), (Some("a\nb"), None));
        assert!(shell_line("plain").is_none());
        let b = split_pasted("look at this\n<pasted_content id=\"f1\">\nl1\nl2\nl3\n</pasted_content id=\"f1\">\nthanks").unwrap();
        assert_eq!(
            b,
            vec![
                CvBlock::Text { text: "look at this".into() },
                CvBlock::Pasted { text: "l1\nl2\nl3".into(), lines: 3 },
                CvBlock::Text { text: "thanks".into() }
            ]
        );
        assert!(split_pasted("no paste").is_none());
    }

    #[test]
    fn hooks_errors_and_refusals() {
        let h = hook_attachment(
            &json!({ "type": "hook_system_message", "content": "Lint failed", "hookName": "PostToolUse:Edit", "hookEvent": "PostToolUse" }),
        )
        .unwrap();
        assert_eq!(h, CvBlock::Hook { event: "PostToolUse".into(), text: "Lint failed".into(), error: false });
        assert!(hook_attachment(&json!({ "type": "hook_success", "content": "x", "hookEvent": "Stop" })).is_none());
        assert!(
            matches!(hook_attachment(&json!({ "type": "hook_cancelled", "hookName": "Stop" })), Some(CvBlock::Hook { text, .. }) if text == "Hook cancelled: Stop")
        );
        assert!(stop_hook_summary(&json!({ "hookCount": 1, "hookErrors": [], "preventedContinuation": false })).is_none());
        assert!(
            matches!(stop_hook_summary(&json!({ "hookErrors": ["boom"] })), Some(CvBlock::Hook { error: true, text, .. }) if text == "boom")
        );
        let e = api_error(&json!({ "isApiErrorMessage": true, "error": "rate_limit", "apiErrorStatus": 429,
            "message": { "model": "<synthetic>", "content": [{ "type": "text", "text": "You've hit your limit" }] } }))
        .unwrap();
        assert_eq!(e, CvBlock::Error { text: "You've hit your limit".into(), code: Some("rate_limit".into()), status: Some(429) });
        assert!(refusal(&json!({ "stop_reason": "refusal" })).is_some());
        assert!(refusal(&json!({ "stop_reason": "end_turn" })).is_none());
    }

    #[test]
    fn queue_and_todos() {
        assert_eq!(queue_op(&json!({ "operation": "enqueue", "content": "next" })), Some(QueueOp::Add("next".into())));
        assert_eq!(queue_op(&json!({ "operation": "enqueue", "content": "<task-notification>…" })), None);
        assert_eq!(queue_op(&json!({ "operation": "dequeue" })), Some(QueueOp::Take(None)));
        let (mut todos, mut pending) = (vec![], vec![]);
        apply_todo(
            &mut todos,
            &mut pending,
            todo_from_tool_use("TaskCreate", "tu1", &json!({ "subject": "Write tests", "activeForm": "Writing tests" })).unwrap(),
        );
        apply_todo(&mut todos, &mut pending, todo_created("tu1", &json!({ "task": { "id": "1", "subject": "Write tests" } })).unwrap());
        apply_todo(
            &mut todos,
            &mut pending,
            todo_from_tool_use("TaskUpdate", "tu2", &json!({ "taskId": "1", "status": "in_progress" })).unwrap(),
        );
        assert_eq!(todos[0].id.as_deref(), Some("1"));
        assert_eq!(todos[0].status, "in_progress");
        apply_todo(
            &mut todos,
            &mut pending,
            todo_from_tool_use("TodoWrite", "tu3", &json!({ "todos": [{ "content": "a", "status": "completed", "activeForm": "A" }] }))
                .unwrap(),
        );
        assert_eq!(todos.len(), 1);
        assert_eq!(todos[0].status, "completed");
    }
}
