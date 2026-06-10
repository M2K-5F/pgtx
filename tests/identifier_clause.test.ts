import { describe, it } from "node:test"
import { deepEqual as assert, throws } from "node:assert"
import { sql } from "../src"

describe("identifier clause test", () => {
    const createParams = () => ({
        text: [] as string[],
        args: [] as any[],
    })

    it("ident test", () => {
        const params = createParams()
        
        sql.ident("identificator").mapIntoQuery(params)

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