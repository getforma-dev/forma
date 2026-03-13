pub mod assets;
pub mod csp;
pub mod ir_compat;
pub mod sw;
pub mod template;
pub mod types;

pub use types::*;
pub use template::render_page;
pub use ir_compat::{check_ir_compatibility, load_ir_modules};
