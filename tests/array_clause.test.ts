import { describe, it } from "node:test"
import  { deepEqual as assert } from "node:assert"
import { arrayClause } from "../src/clauses/array.clause"
import { literalClause } from "../src/clauses/literal.clause"
import { identClause } from "../src/clauses/iden.caluse"
import { fragmentClause } from "../src/clauses/fragment.clause"
import { sql } from "../src"
import { resume } from "react-dom/server"

describe("array clause test", () => {
    it("test array of primitive", () => {
        const array = [10, "string", true, null]

        const result = arrayClause(array).map(1)

        assert(result.text, "$1, $2, $3, $4")
        assert(result.argCounter, 5)
        assert(result.args, [10, "string", true, null])
    })

    it("test array of clauses", () => {
        const array = [literalClause("static"), identClause("ident"), fragmentClause`sql fragment ${"value"}`]

        const result = arrayClause(array).map(1)

        assert(result.text, `static, "ident", sql fragment $1`)
        assert(result.argCounter, 2)
        assert(result.args, ["value"])
    })

    it("array sepatator test", () => {
        const array = [sql.fragment`name = ${"name"}`, sql.fragment`age = ${18}`, sql.fragment`1 = 1`]

        const result = sql.array(array, " AND ").map(1)

        assert(result.text, "name = $1 AND age = $2 AND 1 = 1")
        assert(result.argCounter, 3)
        assert(result.args, ["name", 18])
    })

    it("undefined argument test", (t) => {
        const array = [10, undefined, "string"]

        try {
            const result = sql.array(array).map(1)
        }
        catch (err) {
            if (err instanceof Error) {
                assert(err.message, `Array item at index 1 is undefined`)
                return
            }
        }

        throw new Error("Undefined argument must throw")
    })
})
