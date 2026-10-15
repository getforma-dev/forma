//! Canonical row identity for keyed lists (FORMA-181 checkpoint B, DR-8).
//!
//! A `LIST` named by FMIR section `0x0006` is keyed: for every row the walker
//! reads the row's value at the key path and writes its canonical text as the
//! row root's `data-forma-key`, which `@getforma/core`'s adoption matches
//! rows by. Both sides must produce the same text for the same value, so the
//! domain and the text are fixed here and in
//! `packages/core/src/dom/key-text.ts`, and the shared vectors are
//! `tests/fixtures/parity/keys.json`.
//!
//! The identity domain is a string or a safe integer:
//!
//! - a string is written under value rule 1 (`crate::text::normalize_text`,
//!   FORMA-182): CRLF and CR become LF, NUL becomes U+FFFD, nothing else
//!   changes (no trimming, no NFC, no case folding). This is the text the
//!   browser's parser hands the client, so `"a\r\nb"` and `"a\nb"` are one row;
//! - a number must be an integer within ±(2^53 − 1); it prints as its decimal
//!   integer and `-0` prints as `0`. `1` and `"1"` are therefore the same
//!   key, `1` and `"01"` are not;
//! - `null`, booleans, arrays, objects, fractions, infinities and NaN are not
//!   identities and refuse the render.
//!
//! The path is read against the row's own fields only: every segment but the
//! last must name a field holding an object, the last must name a field
//! holding an identity; a missing field, a field declared twice, or a
//! non-object on the way refuses. No array index, no prototype, no
//! `to_text` coercion. Whether a segment names a field of the row's declared
//! schema type is not checked here: the walker binds data, not types, and
//! closed local rows and signal-seeded rows have no schema at all, so the
//! data-level rule is the one that covers every list (recorded in
//! `docs/DIAGNOSTICS.md` under BUILD-612 and RENDER-503).

use crate::format::ListKeyReason;
use crate::slot::SlotValue;
use crate::text::normalize_text;

/// `Number.MAX_SAFE_INTEGER`: the largest magnitude an ECMAScript number
/// holds exactly, and the bound of the key domain's integers.
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

/// The canonical key text of `row` at `path`, or why there is none.
///
/// `path` is the list's key path resolved to field names, in order.
pub(crate) fn canonical_list_key(row: &SlotValue, path: &[&str]) -> Result<String, ListKeyReason> {
    let mut current = row;
    for segment in path {
        let SlotValue::Object(fields) = current else {
            return Err(ListKeyReason::NotAnObject {
                segment: (*segment).to_string(),
            });
        };
        let mut found = None;
        for (name, value) in fields.iter() {
            if name == segment {
                if found.is_some() {
                    return Err(ListKeyReason::DuplicateField {
                        segment: (*segment).to_string(),
                    });
                }
                found = Some(value);
            }
        }
        current = found.ok_or_else(|| ListKeyReason::MissingField {
            segment: (*segment).to_string(),
        })?;
    }
    canonical_key_text(current)
}

/// The canonical text of one identity value.
pub(crate) fn canonical_key_text(value: &SlotValue) -> Result<String, ListKeyReason> {
    match value {
        SlotValue::Text(text) => Ok(normalize_text(text).into_owned()),
        SlotValue::Number(n) => {
            // `fract() == 0.0` is false for NaN and the infinities, so the
            // range check alone would not be enough and this one is not
            // either: both are needed.
            if !n.is_finite() || n.fract() != 0.0 || n.abs() > MAX_SAFE_INTEGER {
                return Err(ListKeyReason::NotASafeInteger);
            }
            // Within ±2^53 the conversion is exact, and `-0.0 as i64` is `0`.
            Ok((*n as i64).to_string())
        }
        SlotValue::Null => Err(ListKeyReason::NotAnIdentity { kind: "null" }),
        SlotValue::Bool(_) => Err(ListKeyReason::NotAnIdentity { kind: "a boolean" }),
        SlotValue::Array(_) => Err(ListKeyReason::NotAnIdentity { kind: "an array" }),
        SlotValue::Object(_) => Err(ListKeyReason::NotAnIdentity { kind: "an object" }),
    }
}

/// A key as a diagnostic shows it: whole when short, else its first
/// characters and a mark, so a message never carries an unbounded value.
pub(crate) fn key_preview(key: &str) -> String {
    const SHOWN: usize = 48;
    if key.chars().count() <= SHOWN {
        key.to_string()
    } else {
        let mut shown: String = key.chars().take(SHOWN).collect();
        shown.push('\u{2026}');
        shown
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slot::json_to_slot_value;
    use serde_json::Value;

    const VECTORS: &str = include_str!("../tests/fixtures/parity/keys.json");

    fn vectors() -> Value {
        serde_json::from_str(VECTORS).unwrap()
    }

    #[test]
    fn every_shared_key_vector_maps_or_refuses_as_the_file_says() {
        let all = vectors();
        let mut failures = Vec::new();
        let mut seen = 0;
        for case in all["values"].as_array().unwrap() {
            seen += 1;
            let id = case["id"].as_str().unwrap();
            let value = json_to_slot_value(&case["value"]);
            let actual = canonical_key_text(&value);
            match (
                case.get("expected").and_then(Value::as_str),
                case["refused"].as_bool(),
            ) {
                (Some(expected), None) => {
                    if actual.as_deref() != Ok(expected) {
                        failures.push(format!("{id}: gave {actual:?}, expected {expected:?}"));
                    }
                }
                (None, Some(true)) => {
                    if actual.is_ok() {
                        failures.push(format!("{id}: gave {actual:?}, expected a refusal"));
                    }
                }
                other => failures.push(format!("{id}: malformed vector {other:?}")),
            }
        }
        assert!(seen >= 20, "the vector file lost its cases: {seen}");
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[test]
    fn every_shared_collision_vector_agrees_on_whether_two_values_share_a_key() {
        let all = vectors();
        let mut failures = Vec::new();
        for case in all["collisions"].as_array().unwrap() {
            let id = case["id"].as_str().unwrap();
            let values = case["values"].as_array().unwrap();
            let [first, second] = values.as_slice() else {
                failures.push(format!("{id}: a collision vector holds two values"));
                continue;
            };
            let (a, b) = (
                canonical_key_text(&json_to_slot_value(first)).unwrap(),
                canonical_key_text(&json_to_slot_value(second)).unwrap(),
            );
            let collide = case["collide"].as_bool().unwrap();
            if (a == b) != collide {
                failures.push(format!(
                    "{id}: {a:?} and {b:?} {} but the vector says collide={collide}",
                    if a == b { "collide" } else { "differ" }
                ));
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[test]
    fn every_shared_path_vector_resolves_against_the_row_as_the_file_says() {
        let all = vectors();
        let mut failures = Vec::new();
        for case in all["paths"].as_array().unwrap() {
            let id = case["id"].as_str().unwrap();
            let row = json_to_slot_value(&case["row"]);
            let path: Vec<&str> = case["path"]
                .as_array()
                .unwrap()
                .iter()
                .map(|s| s.as_str().unwrap())
                .collect();
            let actual = canonical_list_key(&row, &path);
            match (
                case.get("expected").and_then(Value::as_str),
                case["refused"].as_bool(),
            ) {
                (Some(expected), None) => {
                    if actual.as_deref() != Ok(expected) {
                        failures.push(format!("{id}: gave {actual:?}, expected {expected:?}"));
                    }
                }
                (None, Some(true)) => {
                    if actual.is_ok() {
                        failures.push(format!("{id}: gave {actual:?}, expected a refusal"));
                    }
                }
                other => failures.push(format!("{id}: malformed vector {other:?}")),
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[test]
    fn the_path_refuses_exactly_the_reasons_the_catalogue_names() {
        let row = json_to_slot_value(&serde_json::json!({
            "id": 7, "user": {"id": "u1"}, "flag": true, "none": null, "list": [1], "n": 1.5
        }));
        assert_eq!(canonical_list_key(&row, &["id"]).unwrap(), "7");
        assert_eq!(canonical_list_key(&row, &["user", "id"]).unwrap(), "u1");
        assert_eq!(
            canonical_list_key(&row, &["missing"]),
            Err(ListKeyReason::MissingField {
                segment: "missing".into()
            })
        );
        assert_eq!(
            canonical_list_key(&row, &["id", "deeper"]),
            Err(ListKeyReason::NotAnObject {
                segment: "deeper".into()
            })
        );
        assert_eq!(
            canonical_list_key(&row, &["user"]),
            Err(ListKeyReason::NotAnIdentity { kind: "an object" })
        );
        assert_eq!(
            canonical_list_key(&row, &["list"]),
            Err(ListKeyReason::NotAnIdentity { kind: "an array" })
        );
        assert_eq!(
            canonical_list_key(&row, &["flag"]),
            Err(ListKeyReason::NotAnIdentity { kind: "a boolean" })
        );
        assert_eq!(
            canonical_list_key(&row, &["none"]),
            Err(ListKeyReason::NotAnIdentity { kind: "null" })
        );
        assert_eq!(
            canonical_list_key(&row, &["n"]),
            Err(ListKeyReason::NotASafeInteger)
        );
        // A scalar row cannot be keyed by a path (the compiler refuses the
        // row itself as a key, BUILD-612; a hand-built module gets this).
        assert_eq!(
            canonical_list_key(&SlotValue::Text("row".into()), &["id"]),
            Err(ListKeyReason::NotAnObject {
                segment: "id".into()
            })
        );
        // A field declared twice is ambiguous, not first-wins.
        let twice = SlotValue::object(vec![
            ("id".into(), SlotValue::Number(1.0)),
            ("id".into(), SlotValue::Number(2.0)),
        ]);
        assert_eq!(
            canonical_list_key(&twice, &["id"]),
            Err(ListKeyReason::DuplicateField {
                segment: "id".into()
            })
        );
    }

    #[test]
    fn a_diagnostic_preview_is_bounded_and_counts_characters_not_bytes() {
        assert_eq!(key_preview("short"), "short");
        let long: String = "é".repeat(100);
        let preview = key_preview(&long);
        assert_eq!(preview.chars().count(), 49);
        assert!(preview.ends_with('\u{2026}'));
    }
}
