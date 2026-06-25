# Wap-Lastic: extension summary

**Author:** [Mr Cheese](https://www.mrcheese.co.uk)  
**Platform:** Wappler Server Connect (Node)  
**Module:** `waplastic` · Action: `weightedsearch`

**In one line:** elastic-style, relevance-ranked search for Wappler (tokenised terms, weighted columns, boost fields), without running Elasticsearch or hand-writing huge SQL actions.

---

## The problem

Wappler makes it straightforward to query a database, but **high-quality search** (multiple words, different importance per column, boost fields, exclusions, sorting by relevance, pagination) quickly becomes a **maintenance burden**. Teams often end up with:

- One huge Server Connect action full of raw SQL
- Duplicated logic when a column is added or renamed
- Poor matches when users type partial or reordered phrases (`fishing london` vs `Fishing shop london`)
- Fragile front-end bindings tied to copy-pasted action structure

---

## What Wap-Lastic does

Wap-Lastic is a **reusable Server Connect extension** that sits **after your normal database query**:

1. You keep using Wappler’s query builder for connection, tables, joins, and filters.
2. Wap-Lastic receives that result set, tokenises the user’s search terms, scores each row using **weights you define in the UI**, applies optional boost columns, sorts, and paginates.
3. Each row gets **`relevance_score`** and **`boosted_score`** for debugging or display.

You configure search in **grids and data pickers**, not by cloning a project-specific SQL monster.

---

## Who it’s for

- Wappler developers building **catalogues, directories, listings, or admin search**
- Teams that want **relevance ranking** without maintaining 500+ line actions
- Projects that need **flexible `$_GET` bindings** (any parameter name for terms, limit, offset)
- Anyone migrating **from hand-rolled weighted SQL** to something editable in the IDE

---

## How it’s useful day to day

| Benefit | Detail |
|---------|--------|
| **Faster iteration** | Add or reweight a column in a grid, not in nested SQL |
| **Clearer APIs** | Optional output column list; array response matches query-step bindings |
| **Separation of concerns** | SQL for “what rows are candidates”; Wap-Lastic for “how to rank them” |
| **Portable** | No hardcoded connection names, tables, or column names in the module |
| **Two modes** | In-memory scoring on query results (default), or generated MySQL SQL for scale |

---

## Design principles

- **Generic by default**: every project brings its own schema and bindings.
- **Query-first**: recommended path uses your existing database step.
- **Mr Cheese group**: appears alongside other Server Connect extensions in the same family.

---

## Learn more

Full install and configuration: [README.md](README.md)

**[www.mrcheese.co.uk](https://www.mrcheese.co.uk)**
