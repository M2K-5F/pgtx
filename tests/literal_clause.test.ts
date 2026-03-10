import { describe, it } from "node:test"
import { deepEqual as assert } from "node:assert"
import { sql } from "../src"

describe("literal clause test", () => {
    it('literal test', () => {
        const result = sql.literal("literal").map(1)

        assert(result.text, "literal")
        assert(result.argCounter, 1)
        assert(result.args, [])
    })

    it("undefined behavior test", () => {
        try {
            // @ts-ignore
            const result = sql.literal(undefined).map(1) 
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