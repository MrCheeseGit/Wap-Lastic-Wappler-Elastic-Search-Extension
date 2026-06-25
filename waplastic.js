/**
 * Wap-Lastic: weighted tokenised search for Wappler Server Connect.
 * Primary mode: score and rank rows from a prior database query step (data picker).
 * Advanced mode: generate and run weighted MySQL SQL.
 */

const FORBIDDEN_SQL = /\b(;\s*|--|\/\*|\*\/|union\s|drop\s|delete\s|insert\s|update\s|alter\s|create\s|truncate\s|exec\s|execute\s)\b/i;

/**
 * @param {unknown} value
 * @returns {Array<Record<string, unknown>>}
 */
function parseGrid(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parseGrid(parsed);
        } catch {
            return [];
        }
    }
    if (typeof value === 'object') {
        return Object.keys(value)
            .sort((a, b) => Number(a) - Number(b))
            .map((k) => value[k])
            .filter((row) => row && typeof row === 'object');
    }
    return [];
}

/**
 * @param {unknown} value
 * @returns {Array<Record<string, unknown>>}
 */
function parseSourceRows(value) {
    const grid = parseGrid(value);
    if (grid.length) return grid;
    if (Array.isArray(value)) return value;
    return [];
}

/**
 * Resolve a Wappler binding or plain name to a row property name.
 * e.g. "{{products.name}}" -> "name", "name" -> "name"
 * @param {unknown} input
 * @returns {string}
 */
function resolveFieldName(input) {
    const s = String(input || '').trim();
    if (!s) return '';

    const binding = s.match(/\{\{([^}]+)\}\}/);
    const path = binding ? binding[1].trim() : s;

    if (path.includes('{{')) {
        return '';
    }

    const pathMatch = path.match(/(?:^|[.\[])([a-zA-Z_][a-zA-Z0-9_]*)$/);
    if (pathMatch) {
        return pathMatch[1];
    }

    if (path.includes('.')) {
        const parts = path.split('.').filter(Boolean);
        return parts.length ? parts[parts.length - 1] : '';
    }

    return path;
}

/**
 * Grid cells must not be passed through parseValue; bindings become first-row values.
 * @param {unknown} value
 * @returns {Array<Record<string, unknown>>}
 */
function parseGridRaw(value) {
    return parseGrid(value);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function resolveExcludeFields(value) {
    const raw = String(value || '').trim();
    if (!raw) return [];
    return raw
        .split(',')
        .map((part) => resolveFieldName(part.trim()))
        .filter(Boolean);
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @returns {Array<Record<string, unknown>>}
 */
function normalizeSearchColumns(rows) {
    return rows
        .map((row) => {
            const field = resolveFieldName(row.field || row.column);
            if (!field) return null;
            return {
                field,
                weight: row.weight,
                excludeWhenMatchIn: resolveExcludeFields(row.excludeWhenMatchIn).join(',')
            };
        })
        .filter(Boolean);
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @returns {Array<Record<string, unknown>>}
 */
function normalizeOutputColumns(rows) {
    return rows
        .map((row) => {
            const field = resolveFieldName(row.field || row.column);
            if (!field) return null;
            const type = String(row.type || '').trim();
            return type ? { field, type } : { field };
        })
        .filter(Boolean);
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} fieldName
 * @returns {unknown}
 */
function getRowFieldValue(row, fieldName) {
    if (!fieldName || !row) return '';
    if (Object.prototype.hasOwnProperty.call(row, fieldName)) {
        return row[fieldName];
    }
    const key = Object.keys(row).find((k) => k.toLowerCase() === fieldName.toLowerCase());
    return key ? row[key] : '';
}

/**
 * @param {string} terms
 * @returns {string}
 */
function normalizeSearchTerms(terms) {
    return String(terms || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

/**
 * @param {string} terms
 * @param {number} minLen
 * @param {number} maxWords
 * @returns {string[]}
 */
function tokenizeSearchTerms(terms, minLen, maxWords) {
    const min = Math.min(Math.max(parseInt(String(minLen), 10) || 3, 1), 50);
    const max = Math.min(Math.max(parseInt(String(maxWords), 10) || 10, 1), 20);
    return normalizeSearchTerms(terms)
        .split(' ')
        .filter((w) => w.length >= min)
        .slice(0, max);
}

/**
 * @param {string} expr
 * @returns {string}
 */
function sanitizeSqlFragment(expr) {
    const trimmed = String(expr || '').trim();
    if (!trimmed) {
        throw new Error('Empty SQL expression in search column or sort configuration.');
    }
    if (FORBIDDEN_SQL.test(trimmed)) {
        throw new Error(`Disallowed SQL in expression: ${trimmed.substring(0, 80)}`);
    }
    return trimmed;
}

/**
 * @param {number} maxKeywords
 * @param {number} minKeywordLength
 * @returns {string}
 */
function buildKeywordsCte(maxKeywords, minKeywordLength) {
    const n = Math.min(Math.max(parseInt(String(maxKeywords), 10) || 10, 1), 20);
    const minLen = Math.min(Math.max(parseInt(String(minKeywordLength), 10) || 3, 1), 50);
    const numbers = [];
    for (let i = 1; i <= n; i++) {
        numbers.push(`SELECT ${i} AS n`);
    }
    return `search_keywords AS (
    SELECT TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(:searchTerms, ' ', numbers.n), ' ', -1)) AS keyword
    FROM (${numbers.join(' UNION ALL ')}) numbers
    WHERE numbers.n <= 1 + (LENGTH(:searchTerms) - LENGTH(REPLACE(:searchTerms, ' ', '')))
      AND TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(:searchTerms, ' ', numbers.n), ' ', -1)) != ''
      AND LENGTH(TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(:searchTerms, ' ', numbers.n), ' ', -1))) >= ${minLen}
  )`;
}

/**
 * @param {Array<{column?: string, field?: string, weight?: number|string, excludeWhenMatchIn?: string}>} searchColumns
 * @returns {string}
 */
function buildScoreSumExpression(searchColumns) {
    const cases = [];
    for (const row of searchColumns) {
        const column = row.column
            ? sanitizeSqlFragment(String(row.column))
            : row.field
              ? sanitizeSqlFragment(`LOWER(${resolveFieldName(row.field)})`)
              : '';
        const weight = parseInt(String(row.weight), 10) || 0;
        if (!column || weight <= 0) continue;

        let when = `${column} LIKE CONCAT('%', sk.keyword, '%')`;
        const excludeRaw = String(row.excludeWhenMatchIn || '').trim();
        if (excludeRaw) {
            const excludes = excludeRaw.split(',').map((s) => s.trim()).filter(Boolean);
            const excludeParts = excludes.map((ex) => {
                const safe = ex.includes('(') ? sanitizeSqlFragment(ex) : sanitizeSqlFragment(`LOWER(${resolveFieldName(ex)})`);
                return `${safe} NOT LIKE CONCAT('%', sk.keyword, '%')`;
            });
            if (excludeParts.length) {
                when += ` AND ${excludeParts.join(' AND ')}`;
            }
        }
        cases.push(`CASE WHEN ${when} THEN ${weight} ELSE 0 END`);
    }

    if (!cases.length) {
        throw new Error('Add at least one search column with a field and weight greater than 0.');
    }

    return cases.join(' + ');
}

/**
 * @param {string} scoreSum
 * @param {string} boostColumn
 * @param {number} boostMultiplier
 * @returns {{ relevanceSql: string, boostedSql: string }}
 */
function buildScoreColumns(scoreSum, boostColumn, boostMultiplier) {
    const relevanceSql = `COALESCE((SELECT SUM(${scoreSum}) FROM search_keywords sk), 0)`;
    const boostCol = boostColumn ? sanitizeSqlFragment(boostColumn) : '';
    const mult = parseFloat(String(boostMultiplier)) || 50;

    let boostedSql;
    if (boostCol) {
        boostedSql = `(${relevanceSql}) + ((COALESCE(${boostCol}, 1.0) - 1.0) * ${mult})`;
    } else {
        boostedSql = relevanceSql;
    }

    return {
        relevanceSql: `${relevanceSql} AS relevance_score`,
        boostedSql: `${boostedSql} AS boosted_score`
    };
}

/**
 * @param {string} sortMode
 * @param {string} sortColumn
 * @returns {string}
 */
function buildOrderBy(sortMode, sortColumn) {
    const parts = [];
    const mode = String(sortMode || 'relevance').toLowerCase();
    const sortField = resolveFieldName(sortColumn);

    if (mode === 'column_asc' && sortField) {
        parts.push(`${sanitizeSqlFragment(sortField)} ASC`);
        parts.push('boosted_score DESC');
    } else if (mode === 'column_desc' && sortField) {
        parts.push(`${sanitizeSqlFragment(sortField)} DESC`);
        parts.push('boosted_score DESC');
    } else if (mode !== 'custom') {
        parts.push('boosted_score DESC');
    }

    if (!parts.length) {
        parts.push('boosted_score DESC');
    }

    return `ORDER BY ${parts.join(', ')}`;
}

/**
 * @param {string} whereClause
 * @returns {string}
 */
function normalizeWhereClause(whereClause) {
    const trimmed = String(whereClause || '').trim();
    if (!trimmed) return '';
    if (/^\s*where\b/i.test(trimmed)) return ` ${trimmed}`;
    return ` WHERE ${trimmed}`;
}

/**
 * @param {object} config
 * @returns {{ sql: string, bindings: Record<string, unknown> }}
 */
function buildFullQuery(config) {
    const {
        selectClause,
        fromJoins,
        whereClause,
        searchColumns,
        boostColumn,
        boostMultiplier,
        maxKeywords,
        minKeywordLength,
        hideZeroScoreWhenSearching,
        sortMode,
        sortColumn,
        primaryKey,
        forCount
    } = config;

    const select = String(selectClause || '').trim();
    const from = String(fromJoins || '').trim();
    if (!select) throw new Error('SELECT clause is required for SQL mode.');
    if (!from) throw new Error('FROM / JOIN clause is required for SQL mode.');
    if (!/^\s*from\b/i.test(from)) {
        throw new Error('FROM / JOIN must start with FROM (e.g. FROM products p).');
    }

    const scoreSum = buildScoreSumExpression(searchColumns);
    const boostExpr = boostColumn
        ? sanitizeSqlFragment(
              String(boostColumn).includes('(')
                  ? boostColumn
                  : resolveFieldName(boostColumn)
          )
        : '';
    const { relevanceSql, boostedSql } = buildScoreColumns(scoreSum, boostExpr, boostMultiplier);

    const keywordsCte = buildKeywordsCte(maxKeywords, minKeywordLength);
    const where = normalizeWhereClause(whereClause);

    const innerSelect = forCount
        ? `${primaryKey ? sanitizeSqlFragment(primaryKey) : '1'} AS _waplastic_pk, ${relevanceSql}`
        : `${select},\n    ${relevanceSql},\n    ${boostedSql}`;

    const relevanceFilter = hideZeroScoreWhenSearching
        ? '(:searchTerms = \'\' OR relevance_score > 0)'
        : '1=1';

    let sql = `WITH ${keywordsCte},
relevance_scores AS (
  SELECT
    ${innerSelect}
  ${from}
  ${where}
)
`;

    if (forCount) {
        sql += `SELECT COUNT(*) AS total FROM relevance_scores WHERE ${relevanceFilter}`;
        return { sql, bindings: config.bindings };
    }

    const orderBy = buildOrderBy(sortMode, sortColumn);
    sql += `SELECT * FROM relevance_scores WHERE ${relevanceFilter}
${orderBy}
LIMIT :waplasticLimit OFFSET :waplasticOffset`;

    return { sql, bindings: config.bindings };
}

/**
 * @param {Record<string, unknown>} row
 * @param {string[]} keywords
 * @param {Array<Record<string, unknown>>} searchColumns
 * @returns {number}
 */
function scoreRowRelevance(row, keywords, searchColumns) {
    let relevance = 0;

    for (const kw of keywords) {
        for (const col of searchColumns) {
            const field = resolveFieldName(col.field || col.column);
            const weight = parseInt(String(col.weight), 10) || 0;
            if (!field || weight <= 0) continue;

            const val = String(getRowFieldValue(row, field) ?? '').toLowerCase();
            if (!val.includes(kw)) continue;

            const excludeFields = resolveExcludeFields(col.excludeWhenMatchIn);

            let excluded = false;
            for (const exField of excludeFields) {
                const exVal = String(getRowFieldValue(row, exField) ?? '').toLowerCase();
                if (exVal.includes(kw)) {
                    excluded = true;
                    break;
                }
            }

            if (!excluded) {
                relevance += weight;
            }
        }
    }

    return relevance;
}

/**
 * @param {Record<string, unknown>} row
 * @param {number} relevance
 * @param {string} boostColumn
 * @param {number} boostMultiplier
 * @returns {number}
 */
function applyBoost(row, relevance, boostColumn, boostMultiplier) {
    if (!boostColumn) return relevance;
    const boostField = resolveFieldName(boostColumn);
    const boostVal = parseFloat(String(getRowFieldValue(row, boostField))) || 1;
    const mult = parseFloat(String(boostMultiplier)) || 50;
    return relevance + (boostVal - 1) * mult;
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} sortMode
 * @param {string} sortColumn
 * @returns {Array<Record<string, unknown>>}
 */
function sortScoredRows(rows, sortMode, sortColumn) {
    const mode = String(sortMode || 'relevance').toLowerCase();
    const sortField = resolveFieldName(sortColumn);
    const sorted = [...rows];

    sorted.sort((a, b) => {
        if (mode === 'column_asc' && sortField) {
            const av = getRowFieldValue(a, sortField);
            const bv = getRowFieldValue(b, sortField);
            const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
            if (cmp !== 0) return cmp;
        } else if (mode === 'column_desc' && sortField) {
            const av = getRowFieldValue(a, sortField);
            const bv = getRowFieldValue(b, sortField);
            const cmp = String(bv).localeCompare(String(av), undefined, { numeric: true, sensitivity: 'base' });
            if (cmp !== 0) return cmp;
        }

        const boostDiff = (b.boosted_score || 0) - (a.boosted_score || 0);
        if (boostDiff !== 0) return boostDiff;
        return (b.relevance_score || 0) - (a.relevance_score || 0);
    });

    return sorted;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function toInt(value, fallback) {
    const n = parseInt(String(value), 10);
    return Number.isFinite(n) ? n : fallback;
}

const SCORE_FIELDS = ['relevance_score', 'boosted_score'];

/**
 * @param {unknown} value
 * @returns {string}
 */
function inferMetaType(value) {
    if (value === null || value === undefined) return 'text';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (value instanceof Date) return 'date';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
    return 'text';
}

/**
 * @param {Array<Record<string, unknown>>} outputColumns
 * @param {Record<string, unknown>|null} sampleRow
 * @returns {Array<{name: string, type: string}>}
 */
function buildMetaFromOutputColumns(outputColumns, sampleRow) {
    const meta = [];
    const cols = parseGrid(outputColumns);

    if (cols.length) {
        for (const col of cols) {
            const name = resolveFieldName(col.field || col.column);
            if (!name || SCORE_FIELDS.includes(name)) continue;
            const type = String(col.type || '').trim() || inferMetaType(sampleRow && sampleRow[name]);
            meta.push({ name, type });
        }
    } else if (sampleRow && typeof sampleRow === 'object') {
        for (const key of Object.keys(sampleRow)) {
            if (SCORE_FIELDS.includes(key)) continue;
            meta.push({ name: key, type: inferMetaType(sampleRow[key]) });
        }
    }

    meta.push({ name: 'relevance_score', type: 'number' });
    meta.push({ name: 'boosted_score', type: 'number' });
    return meta;
}

/**
 * @param {Array<Record<string, unknown>>} outputColumns
 * @returns {string[]}
 */
function getOutputFieldNames(outputColumns) {
    const cols = parseGrid(outputColumns);
    if (!cols.length) return [];

    const names = [];
    for (const col of cols) {
        const name = resolveFieldName(col.field || col.column);
        if (name && !names.includes(name)) {
            names.push(name);
        }
    }
    return names;
}

/**
 * @param {Record<string, unknown>} row
 * @param {string[]} fieldNames empty = keep all fields from row
 * @returns {Record<string, unknown>}
 */
function pickOutputFields(row, fieldNames) {
    const picked = {
        relevance_score: row.relevance_score,
        boosted_score: row.boosted_score
    };

    if (!fieldNames.length) {
        for (const [key, value] of Object.entries(row)) {
            if (!SCORE_FIELDS.includes(key)) {
                picked[key] = value;
            }
        }
        return picked;
    }

    for (const name of fieldNames) {
        if (SCORE_FIELDS.includes(name)) continue;
        if (Object.prototype.hasOwnProperty.call(row, name)) {
            picked[name] = row[name];
        } else {
            const key = Object.keys(row).find((k) => k.toLowerCase() === name.toLowerCase());
            if (key) picked[name] = row[key];
        }
    }

    return picked;
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {Array<Record<string, unknown>>} outputColumns
 * @returns {Array<Record<string, unknown>>}
 */
function applyOutputColumns(rows, outputColumns) {
    const fieldNames = getOutputFieldNames(outputColumns);
    return rows.map((row) => pickOutputFields(row, fieldNames));
}

/**
 * @param {object} params
 * @returns {{ data: Array<Record<string, unknown>>, total: number }}
 */
function rankQueryResults(params) {
    const {
        sourceData,
        searchTerms,
        searchColumns,
        boostColumn,
        boostMultiplier,
        minKeywordLength,
        maxKeywords,
        hideZeroScoreWhenSearching,
        sortMode,
        sortColumn,
        limit,
        offset
    } = params;

    const rows = parseSourceRows(sourceData);
    if (!rows.length) {
        return { data: [], total: 0 };
    }

    const keywords = tokenizeSearchTerms(searchTerms, minKeywordLength, maxKeywords);
    const hasSearch = keywords.length > 0;

    let scored = rows.map((row) => {
        const relevance_score = hasSearch ? scoreRowRelevance(row, keywords, searchColumns) : 0;
        const boosted_score = applyBoost(row, relevance_score, boostColumn, boostMultiplier);
        return {
            ...row,
            relevance_score,
            boosted_score
        };
    });

    if (hasSearch && hideZeroScoreWhenSearching) {
        scored = scored.filter((row) => row.relevance_score > 0);
    }

    scored = sortScoredRows(scored, sortMode, sortColumn);

    const total = scored.length;
    const safeLimit = Math.min(Math.max(limit, 1), 10000);
    const safeOffset = Math.max(offset, 0);
    const data = scored.slice(safeOffset, safeOffset + safeLimit);

    return { data, total };
}

/**
 * @param {object} params
 * @returns {unknown}
 */
function formatSearchResponse(params) {
    const {
        data,
        total,
        includeCount,
        responseFormat,
        outputColumns
    } = params;

    const rows = applyOutputColumns(data, outputColumns);

    if (responseFormat === 'object') {
        const response = { success: true, data: rows };
        if (includeCount) {
            response.total = total;
        }
        return response;
    }

    return rows;
}

/**
 * If Wappler passes step meta array, refresh it from selected output columns (design-time hint).
 * @param {unknown} stepMeta
 * @param {Array<Record<string, unknown>>} outputColumns
 * @param {Record<string, unknown>|undefined} sampleRow
 */
function refreshStepMeta(stepMeta, outputColumns, sampleRow) {
    if (!Array.isArray(stepMeta)) return;
    const built = buildMetaFromOutputColumns(outputColumns, sampleRow || null);
    if (!built.length) return;
    stepMeta.length = 0;
    for (const entry of built) {
        stepMeta.push(entry);
    }
}

exports.weightedsearch = async function (options, name, stepMeta) {
    const responseFormat = this.parseOptional(options.responseFormat, 'string', 'array');

    const searchColumns = normalizeSearchColumns(parseGridRaw(options.searchColumns));
    const outputColumns = normalizeOutputColumns(parseGridRaw(options.outputColumns));
    const boostColumn = resolveFieldName(options.boostColumn);
    const sortColumn = resolveFieldName(options.sortColumn);

    try {
        const mode = this.parseOptional(options.mode, 'string', 'query');

        const searchTermsRaw = this.parseOptional(options.searchTerms, 'string', '');
        const searchTerms = normalizeSearchTerms(searchTermsRaw);

        if (!searchColumns.length) {
            throw new Error('Add at least one weighted search column.');
        }

        const boostMultiplier = this.parseOptional(options.boostMultiplier, 'number', 50);
        const minKeywordLength = this.parseOptional(options.minKeywordLength, 'number', 3);
        const maxKeywords = this.parseOptional(options.maxKeywords, 'number', 10);
        const hideZeroScoreWhenSearching = this.parseOptional(
            options.hideZeroScoreWhenSearching,
            'boolean',
            true
        );
        const includeCount = this.parseOptional(options.includeCount, 'boolean', true);

        const sortMode = this.parseOptional(options.sortMode, 'string', 'relevance');

        const limit = toInt(this.parseOptional(options.limit, '*', 100), 100);
        const offset = toInt(this.parseOptional(options.offset, '*', 0), 0);

        if (mode === 'sql') {
            const connection = this.parseOptional(options.connection, 'string', '');
            if (!connection) {
                throw new Error('Database connection is required for SQL generate mode.');
            }

            const knex = this.getDbConnection(connection);
            if (!knex) {
                throw new Error(`Connection "${connection}" doesn't exist.`);
            }

            const queryParams = parseGrid(this.parseOptional(options.queryParams, '*', []));
            const selectClause = this.parseOptional(options.selectClause, 'string', '');
            const fromJoins = this.parseOptional(options.fromJoins, 'string', '');
            const whereClause = this.parseOptional(options.whereClause, 'string', '');
            const primaryKey = this.parseOptional(options.primaryKey, 'string', '');

            const bindings = {
                searchTerms,
                waplasticLimit: Math.min(Math.max(limit, 1), 10000),
                waplasticOffset: Math.max(offset, 0)
            };

            for (const row of queryParams) {
                const param = String(row.param || row.name || '').trim().replace(/^:/, '');
                if (!param) continue;
                if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(param)) {
                    throw new Error(`Invalid query parameter name: ${param}`);
                }
                bindings[param] = row.value !== undefined && row.value !== null ? row.value : '';
            }

            const queryConfig = {
                selectClause,
                fromJoins,
                whereClause,
                searchColumns,
                boostColumn,
                boostMultiplier,
                maxKeywords,
                minKeywordLength,
                hideZeroScoreWhenSearching,
                sortMode,
                sortColumn,
                primaryKey: primaryKey || null,
                bindings
            };

            const { sql } = buildFullQuery({ ...queryConfig, forCount: false });
            const result = await knex.raw(sql, bindings);
            const data = Array.isArray(result[0]) ? result[0] : result;

            let total;
            if (includeCount) {
                const { sql: countSql } = buildFullQuery({ ...queryConfig, forCount: true });
                const countResult = await knex.raw(countSql, bindings);
                const countRows = Array.isArray(countResult[0]) ? countResult[0] : countResult;
                total = countRows && countRows[0] ? countRows[0].total : 0;
            }

            const formatted = formatSearchResponse({
                data,
                total: includeCount ? total : 0,
                includeCount,
                responseFormat,
                outputColumns
            });
            refreshStepMeta(stepMeta, outputColumns, data[0]);
            return formatted;
        }

        const sourceData = this.parseOptional(options.sourceData, '*', []);
        const rows = parseSourceRows(sourceData);
        if (!rows.length) {
            throw new Error(
                'Query results are empty. Add a database query step above this action, then bind its output to "Query results".'
            );
        }

        const { data, total } = rankQueryResults({
            sourceData: rows,
            searchTerms,
            searchColumns,
            boostColumn,
            boostMultiplier,
            minKeywordLength,
            maxKeywords,
            hideZeroScoreWhenSearching,
            sortMode,
            sortColumn,
            limit,
            offset
        });

        const formatted = formatSearchResponse({
            data,
            total,
            includeCount,
            responseFormat,
            outputColumns
        });
        refreshStepMeta(stepMeta, outputColumns, rows[0]);
        return formatted;
    } catch (error) {
        if (responseFormat === 'array') {
            return [];
        }
        return {
            success: false,
            data: [],
            error: error.message
        };
    }
};

exports._buildKeywordsCte = buildKeywordsCte;
exports._buildScoreSumExpression = buildScoreSumExpression;
exports._buildFullQuery = buildFullQuery;
exports._parseGrid = parseGrid;
exports._normalizeSearchTerms = normalizeSearchTerms;
exports._rankQueryResults = rankQueryResults;
exports._resolveFieldName = resolveFieldName;
exports._buildMetaFromOutputColumns = buildMetaFromOutputColumns;
exports._pickOutputFields = pickOutputFields;
exports._applyOutputColumns = applyOutputColumns;
exports._parseGridRaw = parseGridRaw;
exports._normalizeSearchColumns = normalizeSearchColumns;
exports._normalizeOutputColumns = normalizeOutputColumns;
