// Public Form Catalog service (stub). Serves PUBLIC form knowledge DOWN only
// (metadata + field-maps). NEVER receives user content. In production this also
// serves the on-device search index; here it returns a tiny demo catalog.
//
// Types mirror @projectpdfs/shared (kept inline to stay dependency-light for now).
import { createServer } from "node:http";

type FormKind = "Pdf" | "Docx" | "Xlsx" | "WebForm";
interface FieldSpec {
  name: string;
  ontology_key: string;
}
interface CatalogEntry {
  id: string;
  name: string;
  kind: FormKind;
  field_map: { fields: FieldSpec[] };
}

const CATALOG: CatalogEntry[] = [
  {
    id: "sample.passport.v1",
    name: "Sample Passport Application",
    kind: "Pdf",
    field_map: {
      fields: [
        { name: "Full name", ontology_key: "full_name" },
        { name: "Date of birth", ontology_key: "date_of_birth" },
        { name: "Nationality", ontology_key: "nationality" },
      ],
    },
  },
];

const port = Number(process.env.PORT ?? 8787);

const server = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  // Down-only, public. No endpoint ever accepts user content.
  if (req.url === "/health") {
    res.end(JSON.stringify({ status: "ok", service: "catalog", entries: CATALOG.length }));
    return;
  }
  if (req.url === "/v1/catalog") {
    // index: metadata only (no user data ever)
    res.end(JSON.stringify(CATALOG.map(({ id, name, kind }) => ({ id, name, kind }))));
    return;
  }
  const match = req.url?.match(/^\/v1\/catalog\/(.+)$/);
  if (match) {
    const entry = CATALOG.find((e) => e.id === decodeURIComponent(match[1]!));
    if (entry) {
      res.end(JSON.stringify(entry));
      return;
    }
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[catalog] public Form Catalog listening on :${port}`);
});
