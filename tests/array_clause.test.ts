import { describe, it } from "node:test"
import  { deepEqual as assert, throws } from "node:assert"
import { sql } from "../src"

describe("array clause test", () => {
    const createParams = () => ({
        text: [] as string[],
        args: [] as any[],
        counter: 1
    });

    it("test array of primitive", () => {
        const array = [10, "string", true, null]
        const params = createParams()

        sql.array(array).mapIntoQuery(params)

        assert(params.text.join(''), "$1, $2, $3, $4")
        assert(params.counter, 5)
        assert(params.args, [10, "string", true, null])
    })

    it("test array of clauses", () => {
        const array = [
            sql.literal("static"), 
            sql.ident("ident"), 
            sql.fragment`sql fragment ${"value"}`
        ]
        const params = createParams()

        sql.array(array).mapIntoQuery(params)

        assert(params.text.join(''), `static, "ident", sql fragment $1`)
        assert(params.counter, 2)
        assert(params.args, ["value"])
    })

    it("array separator test", () => {
        const array = [
            sql.fragment`name = ${"name"}`, 
            sql.fragment`age = ${18}`, 
            sql.fragment`1 = 1`
        ]
        const params = createParams()

        sql.array(array, " AND ").mapIntoQuery(params)

        assert(params.text.join(''), "name = $1 AND age = $2 AND 1 = 1")
        assert(params.counter, 3)
        assert(params.args, ["name", 18])
    })

    it("undefined argument test", () => {
        const array = [10, undefined, "string"]
        const params = createParams()

        throws(
            () => sql.array(array).mapIntoQuery(params),
            {
                name: 'TypeError',
                message: 'Array item at index 1 is undefined'
            }
        )
    })
})