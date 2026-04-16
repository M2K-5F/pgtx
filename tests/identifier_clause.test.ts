import { describe, it } from "node:test"
import { deepEqual as assert, throws } from "node:assert"
import { sql } from "../src"

describe("identifier clause test", () => {
    const createParams = () => ({
        text: [] as string[],
        args: [] as any[],
        counter: 1
    });

    it("ident test", () => {
        const params = createParams()
        
        sql.ident("identificator").mapIntoQuery(params)

        assert(params.counter, 1)
        assert(params.args.length, 0)
        assert(params.text.join(''), '"identificator"')
    })

    it("ident undefined parameter test", () => {
        throws(
            () => {
                // @ts-ignore
                sql.ident(undefined)
            },
            {
                name: 'TypeError',
                message: 'Identificator undefined'
            }
        )
    })
})