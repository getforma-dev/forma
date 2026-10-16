//! P17's sequential shared journal. Same format/limits as release-performance-journal.mjs.
//! Only completed measurements call this writer, outside timers/allocation counters.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

const MAX_RECORDS: usize = 256;
const MAX_RECORD: u64 = 8 * 1024 * 1024;
const MAX_LHR: u64 = 32 * 1024 * 1024;
const MAX_TOTAL: u64 = 2 * 1024 * 1024 * 1024;
fn valid_kind(kind: &str) -> bool {
    !kind.is_empty()
        && kind.len() <= 96
        && kind.as_bytes()[0].is_ascii_lowercase()
        && kind
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
pub struct Journal(PathBuf);
impl Journal {
    pub fn from_env(output: &Path) -> Option<Self> {
        std::env::var_os("FORMA_PERFORMANCE_EVIDENCE").map(|directory| {
            let directory = PathBuf::from(directory);
            assert!(
                directory.is_absolute(),
                "performance evidence: absolute directory required"
            );
            assert_eq!(
                output,
                directory.join("native-report.json"),
                "performance evidence: output must belong to attempt"
            );
            Self(directory)
        })
    }
    pub fn write(&self, kind: &str, value: &Value) {
        assert!(valid_kind(kind), "performance evidence: unsafe record name");
        let dir = fs::symlink_metadata(&self.0).unwrap();
        assert!(
            dir.is_dir() && !dir.file_type().is_symlink(),
            "performance evidence: owned directory required"
        );
        let path = self.0.join("manifest.jsonl");
        let stat = fs::symlink_metadata(&path).unwrap();
        assert!(
            stat.is_file() && !stat.file_type().is_symlink() && stat.len() <= 256 * 1024,
            "performance evidence: invalid manifest"
        );
        let text = fs::read_to_string(&path).unwrap();
        assert!(
            text.is_empty() || text.ends_with('\n'),
            "performance evidence: incomplete manifest"
        );
        let mut names = BTreeSet::from(["manifest.jsonl".to_string()]);
        let mut count = 0;
        let mut total = 0_u64;
        for line in text.lines() {
            let entry: Value = serde_json::from_str(line).unwrap();
            count += 1;
            assert!(
                count <= MAX_RECORDS,
                "performance evidence: record count exceeded"
            );
            assert_eq!(entry["sequence"].as_u64(), Some(count as u64));
            let prior = entry["kind"].as_str().unwrap();
            if count == 1 {
                assert_eq!(
                    prior, "attempt",
                    "performance evidence: immutable attempt provenance required"
                );
            }
            assert_ne!(
                prior, "complete",
                "performance evidence: attempt already complete"
            );
            assert!(
                valid_kind(prior),
                "performance evidence: unsafe record name"
            );
            let file = format!("{prior}.json");
            assert_eq!(entry["file"].as_str(), Some(file.as_str()));
            assert!(
                names.insert(file.clone()),
                "performance evidence: duplicate record"
            );
            let bytes = entry["bytes"].as_u64().unwrap();
            let ceiling = if prior.starts_with("mobile-lighthouse-") {
                MAX_LHR
            } else {
                MAX_RECORD
            };
            assert!(
                bytes > 0 && bytes <= ceiling,
                "performance evidence: record size exceeded"
            );
            let digest = entry["sha256"].as_str().unwrap();
            assert!(
                digest.len() == 64
                    && digest
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
                "performance evidence: invalid hash"
            );
            let stat = fs::symlink_metadata(self.0.join(file)).unwrap();
            assert!(
                stat.is_file() && !stat.file_type().is_symlink() && stat.len() == bytes,
                "performance evidence: record bytes differ"
            );
            total = total.checked_add(bytes).unwrap();
            assert!(
                total <= MAX_TOTAL,
                "performance evidence: total size exceeded"
            );
        }
        let actual: BTreeSet<String> = fs::read_dir(&self.0)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        assert_eq!(
            actual, names,
            "performance evidence: unindexed output; attempt cannot resume"
        );
        assert!(
            count > 0,
            "performance evidence: immutable attempt provenance required"
        );
        let filename = format!("{kind}.json");
        assert!(
            !names.contains(&filename),
            "performance evidence: duplicate record"
        );
        assert!(
            count < MAX_RECORDS,
            "performance evidence: record count exceeded"
        );
        let mut bytes = serde_json::to_vec(value).unwrap();
        bytes.push(b'\n');
        assert!(
            bytes.len() as u64 <= MAX_RECORD,
            "performance evidence: record size exceeded"
        );
        assert!(
            total + bytes.len() as u64 <= MAX_TOTAL,
            "performance evidence: total size exceeded"
        );
        let digest: String = Sha256::digest(&bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(self.0.join(&filename))
            .unwrap();
        file.write_all(&bytes).unwrap();
        file.sync_all().unwrap();
        let entry = json!({"sequence":count+1,"kind":kind,"file":filename,"bytes":bytes.len(),"sha256":digest});
        let mut line = serde_json::to_vec(&entry).unwrap();
        line.push(b'\n');
        let mut manifest = OpenOptions::new().append(true).open(path).unwrap();
        manifest.write_all(&line).unwrap();
        manifest.sync_all().unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    fn fixture() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "forma-journal-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&path).unwrap();
        let bytes = b"{\"commit\":\"native-unit-control\"}\n";
        fs::write(path.join("attempt.json"), bytes).unwrap();
        let digest: String = Sha256::digest(bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        fs::write(path.join("manifest.jsonl"), format!("{}\n", json!({"sequence":1,"kind":"attempt","file":"attempt.json","bytes":bytes.len(),"sha256":digest}))).unwrap();
        path
    }
    #[test]
    fn native_journal_checkpoint_and_refusals() {
        let path = fixture();
        let journal = Journal(path.clone());
        let value = json!({"samplesNanoseconds":[1,2,3]});
        journal.write("native-n1-300", &value);
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(path.join("native-n1-300.json")).unwrap())
                .unwrap(),
            value
        );
        assert_eq!(
            fs::read_to_string(path.join("manifest.jsonl"))
                .unwrap()
                .lines()
                .count(),
            2
        );
        assert!(std::panic::catch_unwind(|| journal.write("native-n1-300", &value)).is_err());
        assert!(std::panic::catch_unwind(|| journal.write("../escape", &value)).is_err());
        fs::write(path.join("unindexed.json"), "partial").unwrap();
        assert!(std::panic::catch_unwind(|| journal.write("native-next", &value)).is_err());
        fs::remove_dir_all(path).unwrap();
    }
    // The Node control supplies an existing parent journal, launches this exact
    // test binary, waits for its fsync acknowledgement and SIGKILLs the process.
    // Default unit runs do not sleep or require a caller-owned directory.
    #[test]
    fn native_journal_interruption_bridge() {
        let Some(directory) = std::env::var_os("FORMA_NATIVE_JOURNAL_CONTROL") else {
            return;
        };
        let journal = Journal(PathBuf::from(directory));
        journal.write(
            "native-control-checkpoint",
            &json!({"samplesNanoseconds":[4,5,6]}),
        );
        println!("native-checkpoint-flushed");
        std::io::stdout().flush().unwrap();
        std::thread::sleep(Duration::from_secs(30));
        panic!("native interruption control was not killed");
    }
}
