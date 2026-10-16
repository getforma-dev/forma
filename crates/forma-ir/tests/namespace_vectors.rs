//! FORMA-182: the same frozen FORMA-026 trees drive native, client and browser tests.
//! Attribute order is retained from JSON so the native comparison is byte-exact.
use forma_ir::parser::test_helpers::{
    build_minimal_ir, encode_close_tag, encode_open_tag, encode_text,
};
use forma_ir::{walk_to_html, IrModule, SlotData};
use serde::de::{MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use std::fmt;

#[derive(Deserialize)]
struct Vectors {
    vectors: Vec<Vector>,
}
#[derive(Deserialize)]
struct Vector {
    name: String,
    server: String,
    tree: Tree,
}
enum Tree {
    Text(String),
    Element(String, Vec<(String, String)>, Vec<Tree>),
}
struct Attributes(Vec<(String, String)>);
impl<'de> Deserialize<'de> for Attributes {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Ordered;
        impl<'de> Visitor<'de> for Ordered {
            type Value = Attributes;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("an ordered string attribute map or null")
            }
            fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                Ok(Attributes(Vec::new()))
            }
            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
                let mut attrs = Vec::new();
                while let Some(entry) = map.next_entry()? {
                    attrs.push(entry);
                }
                Ok(Attributes(attrs))
            }
        }
        deserializer.deserialize_any(Ordered)
    }
}
impl<'de> Deserialize<'de> for Tree {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Node;
        impl<'de> Visitor<'de> for Node {
            type Value = Tree;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("text or [tag, attributes, ...children]")
            }
            fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Tree, E> {
                Ok(Tree::Text(value.into()))
            }
            fn visit_seq<S: SeqAccess<'de>>(self, mut seq: S) -> Result<Tree, S::Error> {
                let tag = seq
                    .next_element()?
                    .ok_or_else(|| serde::de::Error::custom("missing tag"))?;
                let Attributes(attrs) = seq
                    .next_element()?
                    .ok_or_else(|| serde::de::Error::custom("missing attributes"))?;
                let mut children = Vec::new();
                while let Some(child) = seq.next_element()? {
                    children.push(child);
                }
                Ok(Tree::Element(tag, attrs, children))
            }
        }
        deserializer.deserialize_any(Node)
    }
}

fn string(strings: &mut Vec<String>, value: &str) -> u32 {
    let index = u32::try_from(strings.len()).unwrap();
    strings.push(value.into());
    index
}
fn encode(tree: &Tree, strings: &mut Vec<String>, ops: &mut Vec<u8>) {
    match tree {
        Tree::Text(value) => ops.extend(encode_text(string(strings, value))),
        Tree::Element(tag, attrs, children) => {
            let tag = string(strings, tag);
            let attrs: Vec<_> = attrs
                .iter()
                .map(|(key, value)| (string(strings, key), string(strings, value)))
                .collect();
            ops.extend(encode_open_tag(tag, &attrs));
            for child in children {
                encode(child, strings, ops);
            }
            ops.extend(encode_close_tag(tag));
        }
    }
}

#[test]
fn frozen_namespace_trees_are_written_by_the_real_native_walker() {
    let vectors: Vectors =
        serde_json::from_str(include_str!("fixtures/parity/namespaces.json")).unwrap();
    assert_eq!(vectors.vectors.len(), 7);
    for vector in vectors.vectors {
        let (mut strings, mut ops) = (Vec::new(), Vec::new());
        encode(&vector.tree, &mut strings, &mut ops);
        let borrowed: Vec<_> = strings.iter().map(String::as_str).collect();
        let module = IrModule::parse(&build_minimal_ir(&borrowed, &[], &ops, &[])).unwrap();
        // The script case remains a low-level parser reference. v3 client
        // construction explicitly refuses it; neither this test nor moving
        // the fixture widens that admission policy or adds a namespace stack.
        assert_eq!(
            walk_to_html(&module, &SlotData::new(0)).unwrap(),
            vector.server,
            "{}",
            vector.name
        );
    }
}
