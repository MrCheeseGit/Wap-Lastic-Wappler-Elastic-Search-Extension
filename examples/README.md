# Examples

Sample Server Connect API fragments for **Wap-Lastic**.

---

## `generic-weighted-search.json`

**Use this as your starting template.**

| Piece | What to replace |
|-------|-----------------|
| `your_connection_name` | Your Wappler database connection |
| `products` / columns | Your table and fields |
| `productsQuery` / `searchResults` | Your step names |
| `$_GET.q`, `limit`, `offset` | Your URL parameters |

### What it demonstrates

- Database **SELECT** query step
- Wap-Lastic in **From query step** mode
- Weighted columns (`name`, `description`)
- Optional **output columns** and **boost** on `priority`
- Array response for App Connect repeats

Import or copy the steps into a test API, run once with **Output** enabled, then save so Wap-Lastic step `meta` is populated for the page picker.

---

## Module files

The runnable extension is in the repo root:

- `../waplastic.js`
- `../waplastic.hjson`

---

**[Mr Cheese](https://www.mrcheese.co.uk)** · [Main README](../README.md)
