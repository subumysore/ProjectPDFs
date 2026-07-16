// Shared domain types. These mirror the Rust core's serde wire format
// (snake_case) so they type the values crossing the UI <-> core bridge and the
// catalog service responses. Single source of truth per concept (governance §1).

export type FormKind = "Pdf" | "Docx" | "Xlsx" | "WebForm";

/** A person/role whose data lives on-device. */
export interface Profile {
  id: string;
  name: string;
}

/** A reusable key -> value a Profile holds. */
export interface DataPoint {
  key: string;
  value: string;
}

/** One field: presentation + canonical ontology key. */
export interface FieldSpec {
  name: string;
  ontology_key: string;
}

/** A public form's field layout. */
export interface FieldMap {
  fields: FieldSpec[];
}

/** A known public form in the catalog (public knowledge, no user data). */
export interface CatalogEntry {
  id: string;
  name: string;
  kind: FormKind;
  field_map: FieldMap;
}

/** A field filled from the vault (value is null when the vault lacks the key). */
export interface FilledField {
  name: string;
  ontology_key: string;
  value: string | null;
}
