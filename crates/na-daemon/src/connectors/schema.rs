//! Tool input schemas of connectors. Connector authors (often a coding agent) write them by hand
//! and sometimes use the wrong words (`"type": "bool"`). A provider rejects the whole request for
//! one bad schema, so every schema is normalized to valid JSON Schema when it is read.

use serde_json::{Map, Value, json};

const TYPES: &[&str] = &["string", "number", "integer", "boolean", "array", "object", "null"];

fn alias(t: &str) -> Option<&'static str> {
    let l = t.trim().to_lowercase();
    Some(match l.as_str() {
        "bool" => "boolean",
        "int" | "long" => "integer",
        "float" | "double" | "decimal" => "number",
        "str" | "text" => "string",
        "list" => "array",
        "dict" | "map" | "json" => "object",
        _ => return TYPES.iter().find(|x| **x == l).copied(),
    })
}

/// The empty schema: a tool without arguments.
pub fn empty() -> Value {
    json!({ "type": "object", "properties": {} })
}

fn at(path: &str, what: String) -> String {
    if path.is_empty() { what } else { format!("{path}: {what}") }
}

fn fix_type(t: &mut Value, path: &str, fixes: &mut Vec<String>) {
    match t {
        Value::String(s) => match alias(s) {
            Some(a) if a == s => {}
            Some(a) => {
                fixes.push(at(path, format!("type \"{s}\" should be \"{a}\"")));
                *t = json!(a);
            }
            None => {
                fixes.push(at(path, format!("unknown type \"{s}\" removed")));
                *t = Value::Null;
            }
        },
        Value::Array(a) => {
            let mut out: Vec<Value> = vec![];
            for x in a.iter() {
                let Some(s) = x.as_str() else { continue };
                match alias(s) {
                    Some(n) => {
                        if n != s {
                            fixes.push(at(path, format!("type \"{s}\" should be \"{n}\"")));
                        }
                        if !out.iter().any(|o| o == n) {
                            out.push(json!(n));
                        }
                    }
                    None => fixes.push(at(path, format!("unknown type \"{s}\" removed"))),
                }
            }
            *t = match out.len() {
                0 => Value::Null,
                1 => out.remove(0),
                _ => Value::Array(out),
            };
        }
        _ => {
            fixes.push(at(path, "type must be a string or a list of strings; removed".into()));
            *t = Value::Null;
        }
    }
}

fn sub(path: &str, key: &str) -> String {
    if path.is_empty() { key.to_string() } else { format!("{path}.{key}") }
}

fn fix_node(node: &mut Map<String, Value>, path: &str, fixes: &mut Vec<String>) {
    if let Some(t) = node.get_mut("type") {
        fix_type(t, path, fixes);
        if t.is_null() {
            node.remove("type");
        }
    }
    if let Some(p) = node.get_mut("properties") {
        match p.as_object_mut() {
            Some(props) => {
                let bad: Vec<String> = props.iter().filter(|(_, v)| !v.is_object() && !v.is_boolean()).map(|(k, _)| k.clone()).collect();
                for k in bad {
                    fixes.push(at(&sub(path, &k), "not a schema; removed".into()));
                    props.remove(&k);
                }
                for (k, v) in props.iter_mut() {
                    if let Some(o) = v.as_object_mut() {
                        fix_node(o, &sub(path, k), fixes);
                    }
                }
            }
            None => {
                fixes.push(at(path, "properties must be an object; removed".into()));
                node.remove("properties");
            }
        }
    }
    if node.contains_key("required") {
        let names: Option<Vec<String>> = node.get("properties").and_then(Value::as_object).map(|p| p.keys().cloned().collect());
        match node["required"].as_array() {
            Some(req) => {
                let keep: Vec<Value> = req
                    .iter()
                    .filter(|r| match (r.as_str(), &names) {
                        (Some(s), Some(n)) => n.iter().any(|x| x == s),
                        (Some(_), None) => true,
                        _ => false,
                    })
                    .cloned()
                    .collect();
                if keep.len() != req.len() {
                    fixes.push(at(path, "required lists names that are not properties; removed them".into()));
                }
                node.insert("required".into(), Value::Array(keep));
            }
            None => {
                fixes.push(at(path, "required must be a list; removed".into()));
                node.remove("required");
            }
        }
    }
    if let Some(e) = node.get("enum")
        && !e.is_array()
    {
        fixes.push(at(path, "enum must be a list; removed".into()));
        node.remove("enum");
    }
    for key in ["items", "additionalProperties", "not", "contains"] {
        match node.get_mut(key) {
            Some(Value::Object(o)) => fix_node(o, &format!("{path}[{key}]").replace("[items]", "[]"), fixes),
            Some(Value::Bool(_)) | None => {}
            Some(_) => {
                fixes.push(at(path, format!("{key} must be a schema; removed")));
                node.remove(key);
            }
        }
    }
    for key in ["anyOf", "oneOf", "allOf", "prefixItems"] {
        if let Some(v) = node.get_mut(key) {
            match v.as_array_mut() {
                Some(a) => {
                    a.retain(Value::is_object);
                    for x in a.iter_mut() {
                        if let Some(o) = x.as_object_mut() {
                            fix_node(o, path, fixes);
                        }
                    }
                }
                None => {
                    fixes.push(at(path, format!("{key} must be a list; removed")));
                    node.remove(key);
                }
            }
        }
    }
    for key in ["$defs", "definitions", "patternProperties"] {
        if let Some(Value::Object(m)) = node.get_mut(key) {
            m.retain(|_, v| v.is_object());
            for (k, v) in m.iter_mut() {
                if let Some(o) = v.as_object_mut() {
                    fix_node(o, &sub(path, k), fixes);
                }
            }
        }
    }
}

/// A valid input schema for a tool, plus what had to be fixed (empty when it was fine).
/// `Err` when it cannot be repaired. A missing schema (null) becomes "no arguments" silently.
pub fn normalize(schema: &Value) -> Result<(Value, Vec<String>), String> {
    let mut fixes = vec![];
    let mut top = match schema {
        Value::Null => return Ok((empty(), fixes)),
        Value::Object(o) => o.clone(),
        other => return Err(format!("the input schema is {}, not an object", kind(other))),
    };
    match top.get("type").and_then(Value::as_str).and_then(alias) {
        Some("object") => {}
        None if !top.contains_key("type") => fixes.push("input schema has no type; set to \"object\"".into()),
        _ => fixes.push("input schema type must be \"object\"; set".into()),
    }
    top.remove("type");
    fix_node(&mut top, "", &mut fixes);
    top.insert("type".into(), json!("object"));
    if !top.get("properties").is_some_and(Value::is_object) {
        top.insert("properties".into(), json!({}));
    }
    Ok((Value::Object(top), fixes))
}

fn kind(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "a boolean",
        Value::Number(_) => "a number",
        Value::String(_) => "a string",
        Value::Array(_) => "a list",
        Value::Object(_) => "an object",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_type_aliases_everywhere() {
        let s = json!({ "type": "object", "properties": {
            "pinned": { "type": "bool" },
            "n": { "type": "int" },
            "tags": { "type": "list", "items": { "type": "str" } },
            "x": { "type": ["float", "null", "double"] },
            "nested": { "type": "dict", "properties": { "ok": { "type": "Boolean" } } } } });
        let (v, fixes) = normalize(&s).unwrap();
        assert_eq!(v["properties"]["pinned"]["type"], "boolean");
        assert_eq!(v["properties"]["n"]["type"], "integer");
        assert_eq!(v["properties"]["tags"]["type"], "array");
        assert_eq!(v["properties"]["tags"]["items"]["type"], "string");
        assert_eq!(v["properties"]["x"]["type"], json!(["number", "null"]));
        assert_eq!(v["properties"]["nested"]["properties"]["ok"]["type"], "boolean");
        assert!(fixes.contains(&"pinned: type \"bool\" should be \"boolean\"".to_string()), "{fixes:?}");
        assert!(fixes.iter().any(|f| f.starts_with("tags[]: ")), "{fixes:?}");
    }

    #[test]
    fn valid_schemas_are_untouched() {
        let s = json!({ "type": "object", "properties": { "a": { "type": "string", "enum": ["x"] } }, "required": ["a"] });
        let (v, fixes) = normalize(&s).unwrap();
        assert_eq!(v, s);
        assert!(fixes.is_empty());
    }

    #[test]
    fn fixes_the_top_level() {
        assert_eq!(normalize(&Value::Null).unwrap(), (empty(), vec![]));
        let (v, f) = normalize(&json!({ "properties": { "a": { "type": "string" } } })).unwrap();
        assert_eq!(v["type"], "object");
        assert_eq!(f.len(), 1);
        let (v, _) = normalize(&json!({ "type": "object", "properties": null })).unwrap();
        assert_eq!(v, empty());
        let (v, _) = normalize(&json!({})).unwrap();
        assert_eq!(v, empty());
        assert!(normalize(&json!("nope")).is_err());
        assert!(normalize(&json!([1])).is_err());
    }

    #[test]
    fn drops_unknown_types_bad_properties_and_bad_required() {
        let s = json!({ "type": "object", "properties": { "a": { "type": "wat" }, "b": "string", "c": 5 }, "required": ["a", "ghost", 7] });
        let (v, fixes) = normalize(&s).unwrap();
        assert!(v["properties"]["a"].get("type").is_none());
        assert!(v["properties"].get("b").is_none() && v["properties"].get("c").is_none());
        assert_eq!(v["required"], json!(["a"]));
        assert!(fixes.iter().any(|f| f.contains("unknown type \"wat\"")), "{fixes:?}");
    }

    #[test]
    fn nested_required_and_combinators() {
        let s = json!({ "type": "object", "properties": { "o": { "type": "object", "properties": { "a": { "type": "bool" } }, "required": ["a", "z"] },
            "u": { "anyOf": [ { "type": "int" }, "junk" ] } } });
        let (v, _) = normalize(&s).unwrap();
        assert_eq!(v["properties"]["o"]["required"], json!(["a"]));
        assert_eq!(v["properties"]["u"]["anyOf"], json!([{ "type": "integer" }]));
    }
}
