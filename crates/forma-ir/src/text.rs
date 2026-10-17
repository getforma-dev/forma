//! Rule 1 of the value rules (FORMA-182, `docs/parity-rules.md`): the text
//! normalization every ordinary DOM text and attribute write applies, shared
//! by the walker's escapers and by the keyed-row key text (`crate::keys`,
//! FORMA-181).
//!
//! `N(s)`: each CRLF pair becomes one LF, each remaining CR becomes LF, each
//! NUL becomes U+FFFD, and every other code point is preserved: no trimming,
//! no NFC, no case folding. It applies per authored or bound value, after the
//! value-to-string conversion and before escaping, so a browser parsing the
//! walker's HTML and `@getforma/core` writing the same value to the DOM agree
//! byte for byte. It never applies to transport: declared props, the state
//! envelope, keys as data, source strings and digests stay exact; only the
//! key's text written as `data-forma-key` is normalized.
//!
//! The shared vectors are `tests/fixtures/parity/normalization.json`; core's
//! `normalizeDomText` reads the same file.
//!
//! Crate-private on purpose: no consumer builds on it, and the walker's
//! escapers stream the normalized characters straight into the bounded output
//! rather than allocating a rewritten copy to check a limit afterwards.

use std::borrow::Cow;
use std::iter::Peekable;
use std::str::Chars;

/// The characters of `text` under rule 1, in order, without allocating.
pub(crate) fn normalized_chars(text: &str) -> NormalizedChars<'_> {
    NormalizedChars {
        chars: text.chars().peekable(),
    }
}

/// `text` under rule 1 as one string: borrowed when nothing changes.
///
/// For values that are already owned `String`s (control text, select
/// values) where a second allocation is the existing cost. Streaming writes
/// use [`normalized_chars`].
pub(crate) fn normalize_text(text: &str) -> Cow<'_, str> {
    if text.contains(['\r', '\0']) {
        Cow::Owned(normalized_chars(text).collect())
    } else {
        Cow::Borrowed(text)
    }
}

/// See [`normalized_chars`].
pub(crate) struct NormalizedChars<'a> {
    chars: Peekable<Chars<'a>>,
}

impl Iterator for NormalizedChars<'_> {
    type Item = char;

    fn next(&mut self) -> Option<char> {
        match self.chars.next()? {
            '\r' => {
                // A CRLF pair is one line feed; the LF is consumed here so a
                // separately authored `"\r"` then `"\n"` (two values, two
                // iterators) stays two line feeds.
                if self.chars.peek() == Some(&'\n') {
                    self.chars.next();
                }
                Some('\n')
            }
            '\0' => Some('\u{FFFD}'),
            other => Some(other),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    const VECTORS: &str = include_str!("../tests/fixtures/parity/normalization.json");

    fn section(name: &str) -> Vec<Value> {
        let all: Value = serde_json::from_str(VECTORS).unwrap();
        all[name].as_array().unwrap().clone()
    }

    #[test]
    fn every_shared_value_vector_maps_through_the_iterator_and_the_collector() {
        let mut failures = Vec::new();
        for case in section("values") {
            let (id, input, expected) = (
                case["id"].as_str().unwrap(),
                case["input"].as_str().unwrap(),
                case["expected"].as_str().unwrap(),
            );
            let streamed: String = normalized_chars(input).collect();
            if streamed != expected {
                failures.push(format!(
                    "{id}: iterator gave {streamed:?}, expected {expected:?}"
                ));
            }
            let collected = normalize_text(input);
            if collected != expected {
                failures.push(format!(
                    "{id}: collector gave {collected:?}, expected {expected:?}"
                ));
            }
            let borrowed = matches!(collected, Cow::Borrowed(_));
            if borrowed != (input == expected) {
                failures.push(format!(
                    "{id}: borrowed={borrowed} but input {} expected",
                    if input == expected {
                        "equals"
                    } else {
                        "differs from"
                    }
                ));
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[test]
    fn a_crlf_split_across_two_values_is_two_line_feeds() {
        // Per value, not per stream: the pair is only folded inside one value.
        let joined: String = normalized_chars("\r")
            .chain(normalized_chars("\n"))
            .collect();
        assert_eq!(joined, "\n\n");
        let folded: String = normalized_chars("\r\n").collect();
        assert_eq!(folded, "\n");
    }

    #[test]
    fn the_iterator_reports_no_exact_size_and_the_byte_count_is_the_normalized_one() {
        // NUL is one UTF-8 byte and U+FFFD is three; CRLF is two and LF one.
        // A writer that budgets on the input's byte length is wrong in both
        // directions, which is why the escapers count each character pushed.
        let bytes: usize = normalized_chars("\0\r\n").map(char::len_utf8).sum();
        assert_eq!(bytes, 4);
        assert_eq!("\0\r\n".len(), 3);
    }
}
