import { arrayClause } from "./clauses/array.clause";
import { fragmentClause } from "./clauses/fragment.clause";
import { identClause } from "./clauses/iden.caluse";
import { Pool as PgtxPool } from "./pool";
import { staticClause } from "./clauses/static.clause";
import { updateClause } from "./clauses/update.clause";
import { valueClause } from "./clauses/values.clause";  

/**
 * Core SQL tagging utility for Pgtx.
 * Provides type-safe helpers for building dynamic queries with recursive support.
 */
export const sql = {
    /** 
     * Creates a VALUES clause for INSERT queries.
     * Supports single objects and arrays of objects.
     * 
     * @example 
     * sql.insert({ name: 'Ivan', age: 25 }) 
     * // Result: (name, age) VALUES ($1, $2)
     * 
     * @example 
     * sql.insert([{ id: 1 }, { id: 2 }]) 
     * // Result: (id) VALUES ($1), ($2)
     */
    insert: valueClause,

    /** 
     * Generates a SET clause for UPDATE queries from a JavaScript object.
     * 
     * @example 
     * sql.update({ status: 'active', updated_at: new Date() }) 
     * // Result: status = $1, updated_at = $2
     */
    update: updateClause,

    /** 
     * Safely escapes SQL identifiers (table or column names) using double quotes.
     * 
     * @example 
     * sql.ident('users') 
     * // Result: "users"
     * 
     * @example 
     * sql.ident('table.column') 
     * // Result: "table.column"
     */
    ident: identClause,

    /** 
     * Injects raw, unescaped SQL strings. 
     * ⚠️ Use with caution to prevent SQL injection!
     * 
     * @example 
     * sql.literal('DESC') 
     * // Result: DESC
     */
    literal: staticClause,

    /** 
     * Creates a reusable, recursive SQL fragment.
     * Fragments can be nested within each other; argument numbering is handled automatically.
     * 
     * @example 
     * const filter = sql.fragment`age > ${18}`;
     * sql`SELECT * FROM users WHERE ${filter} AND status = ${'active'}`
     * // Result: SELECT * FROM users WHERE age > $1 AND status = $2
     */
    fragment: fragmentClause,

    /** 
     * Formats an array for dynamic lists (IN clauses, column lists, or joined conditions).
     * Supports recursive Clauses (fragments, idents) within the array.
     * 
     * @example 
     * // Case A: IN clause (manual brackets)
     * sql`WHERE id IN (${sql.array([1, 2])})`
     * // Result: WHERE id IN ($1, $2)
     * 
     * @example 
     * // Case B: Dynamic WHERE conditions
     * const conds = [sql.fragment`a = 1`, sql.fragment`b = ${2}`];
     * sql`WHERE ${sql.array(conds, ' AND ')}`
     * // Result: WHERE a = 1 AND b = $1
     * 
     * @example 
     * // Case C: Column list
     * sql`SELECT ${sql.array([sql.ident('id'), sql.ident('name')])}`
     * // Result: SELECT "id", "name"
     */
    array: arrayClause,
}

/**
 * Main Pgtx Connection Pool. 
 * Manages connections, transactions (including SAVEPOINTs), and prepared statements.
 */
export const Pool = PgtxPool