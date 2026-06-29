import os
import sys
import json
import base64
import re
import tempfile
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI
from flask import Flask, request, jsonify
from flask_cors import CORS

try:
    import fitz
except ImportError:
    print("ERROR: PyMuPDF not installed. Run: pip install pymupdf")
    sys.exit(1)

load_dotenv()

api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAIKEY")
if not api_key:
    print("ERROR: OPENAI_API_KEY not found in environment")
    sys.exit(1)

client = OpenAI(api_key=api_key)
app = Flask(__name__)
CORS(app)

EXTRACT_PROMPT = """
You are an OCR data extraction system for commercial invoices and order documents.

Analyze the ENTIRE document including all headers, footers, logos, tables, and line items.
Extract EVERY product listed — do NOT stop after the first item.

=== SUPPLIER IDENTIFICATION (HIGH PRIORITY) ===
- The supplier is the company ISSUING the document (shown in header logo / sender / "From" / company address block at top).
- NEVER use the customer, consignee, buyer, or "To:" address as the supplier_name.
- Search company name in headers, logos, and sender information.

=== COUNTRY OF ORIGIN ===
- Find the manufacturer's address block (city, country).
- If the manufacturer's registered address contains a country and no explicit manufacturing country is stated elsewhere, use that country.
- Example: manufacturer address contains "Italy" → country_of_origin = "Italy"

=== PRODUCT TABLE PARSING ===
- Find the product line-item table. Column headers may be in Italian, English, or both, such as:
  COD.ARTICOLO / DESCRIZIONE / SCELTA / TONO-CALIBRO / SCATOLE / U.M. / QUANTITA / PREZZO / SCONTO / IMPORTO
- Each row in the table is a SEPARATE product. Extract ALL rows.
- For tile products the description is typically: [SERIES] [COLOR] [SIZE] [FINISH]
  Example: "ETHEREA IVORY MATT R 60X120M" → series=ETHEREA, color=IVORY, size=60X120, finish=MATT R
  Example: "CO.GREY CEMENT SOFT 60X60MH"  → series=CO.GREY, color=CEMENT, size=60X60, finish=SOFT MH
  Example: "ETHEREA STRIPE PERLE 60X120 3D" → series=ETHEREA STRIPE, color=PERLE, size=60X120, finish=3D
  Mirror series/color/name into the English fields.

=== FIELD RULES ===
- supplier_code / supplier_sku: alphanumeric item code at start of each product line (e.g. RJ70, RH43, NA89, RL24, RL25).
  Do NOT use customer account numbers (e.g. 47240) as product codes.
- shade: value from the TONO/CALIBRO or SHADE/CALIBER column (e.g. GP4P/8, GG4P/8, LH4P/8).
  Do NOT use quality-choice codes ("1", "S", "XA0") as shade.
- order_quantity: value from the QUANTITA / QUANTITY / MENGE column (e.g. 100,800 — keep as written).
- unit_of_measure: value from U.M. column (e.g. MQ).
- quantity_per_carton / quantity_per_pallet: fill ONLY if a specific per-box or per-pallet figure is explicitly written next to the product line. Otherwise set null.
- Do NOT invent values. Use null for any field not found.

=== OUTPUT RULES ===
- One JSON object per unique product.
- Return ALL products found — do not truncate.
- Return ONLY valid JSON, no markdown, no commentary.

JSON Schema:
{
  "products": [
    {
      "internal_category": null,
      "supplier_name": null,
      "series": null,
      "color": null,
      "size": null,
      "finish": null,
      "product_image": null,
      "images": [],
      "country_of_origin": null,
      "order_quantity": null,
      "unit_of_measure": null,
      "quantity_per_carton": null,
      "quantity_per_pallet": null,
      "shade": null,
      "supplier_code": null,
      "name_english": null,
      "series_english": null,
      "color_english": null,
      "supplier_sku": null
    }
  ]
}
"""


def pdf_page_to_base64(page) -> str:
    matrix = fitz.Matrix(200 / 72, 200 / 72)
    pix = page.get_pixmap(matrix=matrix)
    return base64.b64encode(pix.tobytes("png")).decode("utf-8")


def extract_from_image(image_b64: str, page_num: int) -> list:
    print(f"  Calling OpenAI for page {page_num}...", flush=True)
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": EXTRACT_PROMPT},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{image_b64}",
                            "detail": "high",
                        },
                    },
                ],
            }
        ],
        max_tokens=4096,
        temperature=0,
    )

    raw = response.choices[0].message.content.strip()

    # Save raw response to debug file
    output_dir = Path(__file__).parent / "openai-output"
    output_dir.mkdir(exist_ok=True)
    debug_path = output_dir / f"debug_page_{page_num}_raw.txt"
    debug_path.write_text(raw, encoding="utf-8")
    print(f"  Raw response saved to {debug_path}", flush=True)
    print(f"  Raw response preview: {raw[:300]!r}", flush=True)

    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)

    try:
        data = json.loads(raw)
        products = data.get("products", [])
        print(f"  Parsed {len(products)} products from page {page_num}", flush=True)
        for p in products:
            p["_page"] = page_num
        return products
    except json.JSONDecodeError as e:
        print(f"  JSON PARSE ERROR on page {page_num}: {e}", flush=True)
        print(f"  Failed JSON snippet: {raw[:500]!r}", flush=True)
        return [{"_parse_error": True, "_raw": raw, "_page": page_num}]


@app.route("/extract", methods=["POST"])
def extract():
    if "pdf" not in request.files:
        return jsonify({"error": "No PDF file provided"}), 400

    file = request.files["pdf"]
    suffix = Path(file.filename).suffix or ".pdf"

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        file.save(tmp.name)
        tmp_path = tmp.name

    try:
        doc = fitz.open(tmp_path)
        all_products = []

        for i, page in enumerate(doc, start=1):
            print(f"Processing page {i}/{len(doc)}...")
            image_b64 = pdf_page_to_base64(page)
            products = extract_from_image(image_b64, i)
            all_products.extend(products)

        doc.close()

        # Save to openai-output folder
        output_dir = Path(__file__).parent / "openai-output"
        output_dir.mkdir(exist_ok=True)
        output_path = output_dir / (Path(file.filename).stem + "_extracted.json")
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(all_products, f, ensure_ascii=False, indent=2)

        print(f"Saved to {output_path}")
        return jsonify({"products": all_products, "total": len(all_products)})

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        os.unlink(tmp_path)


ALL_FIELDS = [
    "internal_category", "supplier_name", "series", "color", "size", "finish",
    "product_image", "country_of_origin", "order_quantity", "unit_of_measure",
    "quantity_per_carton", "quantity_per_pallet", "shade", "supplier_code",
    "name_english", "series_english", "color_english", "supplier_sku",
]

# Fields that must all be present for a product to be considered complete
REQUIRED_FIELDS = [
    "supplier_name", "series", "color", "size", "finish",
    "country_of_origin", "quantity_per_carton", "supplier_code",
]


def match_key(product: dict) -> str | None:
    """Return a normalised deduplication key, preferring supplier_sku then supplier_code."""
    for field in ("supplier_sku", "supplier_code"):
        val = product.get(field)
        if val and str(val).strip():
            return str(val).strip().upper()
    return None


def extract_all_products_from_pdf(pdf_path: str, filename: str) -> list:
    doc = fitz.open(pdf_path)
    all_products = []
    for i, page in enumerate(doc, start=1):
        print(f"  [{filename}] page {i}/{len(doc)}")
        image_b64 = pdf_page_to_base64(page)
        products = extract_from_image(image_b64, i)
        all_products.extend(products)
    doc.close()
    return [p for p in all_products if not p.get("_parse_error")]


@app.route("/extract-batch", methods=["POST"])
def extract_batch():
    files = request.files.getlist("pdfs")
    if not files or all(f.filename == "" for f in files):
        return jsonify({"error": "No PDF files provided"}), 400

    merged_map: dict = {}
    unkeyed_counter = 0
    tmp_paths = []

    try:
        for file in files:
            if not file or file.filename == "":
                continue

            suffix = Path(file.filename).suffix or ".pdf"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                file.save(tmp.name)
                tmp_paths.append(tmp.name)

            print(f"Processing: {file.filename}")
            products = extract_all_products_from_pdf(tmp_paths[-1], file.filename)
            print(f"  Raw products from OpenAI: {len(products)}")
            for p in products:
                print(f"    supplier_sku={p.get('supplier_sku')!r}  supplier_code={p.get('supplier_code')!r}  series={p.get('series')!r}")

            for product in products:
                key = match_key(product)
                if not key:
                    unkeyed_counter += 1
                    key = f"__unkeyed_{unkeyed_counter}"
                    print(f"  No SKU/code found — using fallback key {key!r}")

                if key not in merged_map:
                    merged_map[key] = {"product": {}, "sources": {}, "docs": []}
                entry = merged_map[key]

                # Enrich: only fill fields that are still empty
                for field in ALL_FIELDS:
                    if entry["product"].get(field) in (None, "") and product.get(field) not in (None, ""):
                        entry["product"][field] = product[field]
                        entry["sources"][field] = file.filename

                if not entry["product"].get("images") and product.get("images"):
                    entry["product"]["images"] = product["images"]
                    entry["sources"]["images"] = file.filename

                if file.filename not in entry["docs"]:
                    entry["docs"].append(file.filename)

        def build_result(entry: dict) -> dict:
            missing = [f for f in REQUIRED_FIELDS if not entry["product"].get(f)]
            return {
                "product": entry["product"],
                "sources": entry["sources"],
                "docs": entry["docs"],
                "missing_required": missing,
                "complete": len(missing) == 0,
            }

        results = [build_result(e) for e in merged_map.values()]
        # Complete products float to the top
        results.sort(key=lambda r: (0 if r["complete"] else 1))

        output_dir = Path(__file__).parent / "openai-output"
        output_dir.mkdir(exist_ok=True)
        output_path = output_dir / "batch_extracted.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)

        complete_count = sum(1 for r in results if r["complete"])
        print(f"Saved {len(results)} products ({complete_count} complete) to {output_path}")
        return jsonify({"products": results, "total": len(results), "complete": complete_count})

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        for p in tmp_paths:
            try:
                os.unlink(p)
            except Exception:
                pass


if __name__ == "__main__":
    print("Server running at http://localhost:5050")
    app.run(port=5050, debug=True)
