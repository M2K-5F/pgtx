import { describe, it } from "node:test"
import { deepEqual as assert } from "node:assert"
import { sql } from "../src"

describe("identifier clause test", () => {
    it("ident test", () => {
        const result = sql.ident("identificator").map(1)

        assert(result.argCounter, 1)
        assert(result.args, [])
        assert(result.text, '"identificator"')
    })

    it("ident undefined parameter test", () => {
        try {
            // @ts-ignore
            const result = sql.ident(undefined).map(1) 
        }
        catch (err) {
            if (err instanceof Error) {
                assert(err.message, "Query parameter undefined at position 1")
                return
            }
        }
        throw new Error("undefined argument in ident must throw")
    })
})