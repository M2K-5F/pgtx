import { describe, it } from "node:test"
import { deepEqual as assert, throws } from "node:assert"
import { sql } from "../src"

describe("literal clause test", () => {
    const createParams = () => ({
        text: [] as string[],
        args: [] as any[],
        counter: 1
    })

    it('literal test', () => {
        const params = createParams()
        
        sql.literal("literal").mapIntoQuery(params)

        assert(params.text.join(''), "literal")
        assert(params.counter, 1)
        assert(params.args.length, 0)
    })

    it("undefined behavior test", () => {
        throws(
            () => {
                // @ts-ignore
                sql.literal(undefined)
            },
            {
                name: 'TypeError',
                message: 'Literal undefined' 
            }
        )
    })
})