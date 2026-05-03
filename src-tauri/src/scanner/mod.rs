// TODO(backend-eng): scanner entry point.
//
// Public API:
//   pub fn scan(library: &Library, db: &Database) -> Result<ScanResult>
//
// Dispatches by library.kind to one of:
//   - courses::scan
//   - series::scan
//   - movies::scan
//   - generic::scan
//
// Common helpers (video ext detection, title cleaning, natural sort) also live
// here. See plan, Agent A.

pub mod courses;
pub mod generic;
pub mod movies;
pub mod series;
