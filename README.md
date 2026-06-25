# Wap-Lastic


**Weighted, tokenised search for Wappler Server Connect**: score and rank database results in the UI, without giant hand-built SQL actions.

Think of it as **elastic-style search for Wappler** (tokenised keywords, per-field weights, relevance ranking): the behaviour you want from “elastic” search, built as a native Server Connect step. It does **not** connect to Elasticsearch or Elastic Cloud; it works on your existing query results or generated MySQL SQL.

[![License: Mr Cheese Extension v1.0](https://img.shields.io/badge/License-Mr%20Cheese%20Extension%20v1.0-blue.svg)](https://www.mrcheese.co.uk/extension-license)
![Wappler](https://img.shields.io/badge/Wappler-Server%20Connect-teal)
![Version](https://img.shields.io/badge/version-1%2E2%2E9-green)

Built by **[Mr Cheese](https://www.mrcheese.co.uk)** · Wappler extensions & custom modules

---

## Why this exists

In Wappler, “good search” often means **enormous Server Connect actions**: keyword CTEs, many `CASE` expressions per column, weights, exclusions, boost columns, sort modes, and pagination, all duplicated when you add a field or change a table.

**Wap-Lastic** replaces that with one step:

1. Run your normal **database query** (your connection, filters, joins).
2. Add **Wap-Lastic Weighted Search** and pick columns + weights in the UI.
3. Return ranked rows with `relevance_score` and `boosted_score`, ready for repeats and data bindings.

Typical problem it solves: a user searches `fishing caldas` but the stored text is `Fishing shop caldas da rainha`. Exact `LIKE` on the whole string fails. Wap-Lastic **tokenises** the search phrase, matches **per column**, applies **weights**, and sorts by relevance, all configured visually, not with another 400-line JSON action.

---

## Features

| Capability | Description |
|------------|-------------|
| **Query-first workflow** | Bind the prior query step; no second connection field in default mode |
| **Weighted columns** | Data picker per column + numeric weight + optional “exclude if also matched in…” |
| **Any search input** | Bind any `$_GET` (or expression) for terms, limit, and offset |
| **Output columns** | Choose which fields go to the API and page; empty = all query columns |
| **Scores on every row** | `relevance_score` and `boosted_score` always included |
| **Boost column** | Optional numeric field from your query (e.g. priority, search score) to push listings higher |
| **Array or object API** | Default array output (works like a query step in App Connect) |
| **SQL generate mode** | Advanced: build weighted MySQL SQL for very large datasets |

No project-specific tables or connections are baked in. Configure everything in your own API after install.

---

## Requirements

- Wappler project with **Server Connect** (Node)
- **Query mode (recommended):** any database query step that returns an array of rows
- **SQL mode (advanced):** MySQL

---

## Installation

| Path | |
|------|--|
| **npm** | Wappler Project Settings → Extensions (`wappler-wap-lastic`) |
| **Git** | [Extension Installer](https://www.mrcheese.co.uk/extensions/install) or manual copy below |

Git manual copy installs into `extensions/` and `lib/modules/`.

### Git install — Extension Installer (recommended)

This repo ships **`wappler-install.json`** at the root. Use the **[Mr Cheese Extension Installer](https://www.mrcheese.co.uk/extensions/install)** — select **Wap-Lastic**, enable **Use wappler-install.json from the repository**, and run the generated copy commands locally.

### Manual install

Run from your **Wappler project root** (the folder that contains `package.json`). Skip `git clone` if you already have this repo cloned alongside your project.

```bash
git clone https://github.com/MrCheeseGit/Wap-Lastic-Wappler-Elastic-Search-Extension.git ../Wap-Lastic-Wappler-Elastic-Search-Extension

cp ../Wap-Lastic-Wappler-Elastic-Search-Extension/server_connect/modules/waplastic.hjson extensions/server_connect/modules/
cp ../Wap-Lastic-Wappler-Elastic-Search-Extension/server_connect/modules/waplastic.js lib/modules/
```

**Quit Wappler completely and restart** after installing or updating.

The action appears under **Mr Cheese → Wap-Lastic Weighted Search**.


### npm install (Wappler Project Settings)

1. **Wappler** → Project Settings → Extensions → Add → `wappler-wap-lastic`
2. From your project root: `npm install`
3. **Quit Wappler completely** and reopen your project.

#### Local `file:` development (optional)

```json
"devDependencies": {
  "wappler-wap-lastic": "file:../path/to/this-extension"
}
```

After you change extension source, run `npm install` again, then Project Updater if needed, and restart Wappler.

## Quick start

```
Database Query (SELECT)  →  Wap-Lastic Weighted Search  →  Page repeat / API output
```

1. Add a **Database Query** step (SELECT) with your connection, table, and filters.
2. Add **Wap-Lastic Weighted Search** below it.
3. **Mode:** *From query step* (default).
4. **Query results:** data picker → your query (e.g. `{{productsQuery}}`).
5. **Search terms:** e.g. `{{$_GET.q}}`.
6. **Weighted columns:** add rows, pick fields, set weights (e.g. `name` = 100, `description` = 50).
7. *(Optional)* **Boost column:** pick a numeric column from your query if you already store a priority or score (see below).
8. **Output columns:** pick fields for the response, or leave empty for all columns.
9. Enable **Output**, run the API once, **save** (refreshes step `meta` for the page picker).
10. On the page, bind the **Wap-Lastic step** (e.g. `{{searchResults}}`), not the raw query step.

See [`examples/generic-weighted-search.json`](examples/generic-weighted-search.json) for a full generic template.

---

## Configuration reference

### Search columns

| Column | Description |
|--------|-------------|
| **Column** | Field from your query (data picker) |
| **Weight** | Higher = ranks higher when the keyword matches |
| **Exclude if also in** | Comma-separated fields; skip this column’s score if the keyword also matches there |

### Boost column (your own score / priority field)

If your query already returns a **numeric score column** (for example `priority`, `searchPriority`, `rank`, or any value you use to promote listings), Wap-Lastic can use it **on top of** keyword relevance.

In the **Scoring** group:

| Setting | Description |
|---------|-------------|
| **Boost column** | Data picker → numeric field from your query step (leave empty to rank by relevance only) |
| **Boost multiplier** | How strongly that column affects sort order (default `50`) |

**How it works**

1. Wap-Lastic calculates **`relevance_score`** from matched search keywords and your weighted columns.
2. If a boost column is set, it computes **`boosted_score`**:

   `boosted_score = relevance_score + (boostColumnValue - 1) * boostMultiplier`

3. Default sort uses **`boosted_score`**, so rows with a higher value in your score column rise when relevance is similar.

**Example:** `priority` = `2` and multiplier = `50` adds 50 points to `relevance_score`. A featured product with a strong priority value can outrank a slightly better text match with low priority.

Include the boost field in your database query SELECT. You do **not** need a separate weight row in **Weighted columns** for the same field unless you also want keyword matching on that column.

See [`examples/generic-weighted-search.json`](examples/generic-weighted-search.json) (`boostColumn`: `priority`, `boostMultiplier`: `50`).

### Output columns

| Column | Description |
|--------|-------------|
| **Column** | Field to include in the response (picker may save `{{yourQuery[0].field}}`; the module extracts `field`) |
| **Type** | Optional; helps schema / picker |

Leave **Output columns** empty to return every column from the query plus both score fields.

### Page data picker

Wappler uses the step **`meta`** array in your API JSON for frontend bindings.

1. Configure output columns (or leave empty).
2. **Run the API** with **Output** enabled, then **save**.
3. Bind `{{yourWaplasticStep}}` on the page.

If only scores appear in the picker, remove stale `meta` on the Wap-Lastic step, run the API again, and save.

### Response shape

**Array (default)**, best for repeats:

```json
[
  {
    "id": 1,
    "name": "Fishing shop",
    "relevance_score": 100,
    "boosted_score": 150
  }
]
```

**Object**, when you need `{ success, data, total }`:

```json
{
  "success": true,
  "data": [{ "id": 1, "name": "Fishing shop", "relevance_score": 100, "boosted_score": 150 }],
  "total": 42
}
```

### SQL generate mode (advanced)

For very large tables:

1. Set **Mode** to *SQL generate*.
2. Set connection, SELECT / FROM / WHERE fragments, and SQL parameters.
3. Use only when query-mode scoring is not suitable.

---

## Project layout

```
Wap-Lastic-Extension/
├── waplastic.js          # Server Connect module
├── waplastic.hjson       # Wappler UI definition
├── package.json
├── README.md             # You are here
├── extension_summary.md  # Short overview
├── CHANGELOG.md
├── LICENSE
└── examples/
    ├── README.md
    └── generic-weighted-search.json
```

---

## Limitations (v1)

- Query mode scores rows **returned by your query** (apply filters in the query step).
- SQL generate mode: **MySQL** only.
- No fuzzy / typo tolerance yet.

---

## Documentation

- [Extension summary](extension_summary.md): problem, approach, and benefits in brief
- [Examples](examples/README.md)
- [Changelog](CHANGELOG.md)

---

## Compatibility

Standalone extension. For shared patterns (Redirect-IT step order, PuSH-IT, optional pairs), see [Mr Cheese extension docs](https://github.com/MrCheeseGit/Wappler-Extension-Docs/blob/main/extension-compatibility.md).

## License

[Mr Cheese Extension License v1.0](https://www.mrcheese.co.uk/extension-license) — see [LICENSE](LICENSE). © [Mr Cheese](https://www.mrcheese.co.uk)

---

**[mrcheese.co.uk](https://www.mrcheese.co.uk)** · Wappler Server Connect extensions
