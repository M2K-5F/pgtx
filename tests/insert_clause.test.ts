import { describe, it } from "node:test"
import { deepEqual as assert } from "node:assert"
import { sql } from "../src"
describe("insert clause test", () => {
    const createParams = () => ({
        text: [] as string[],
        args: [] as any[],
        counter: 1
    });

    it("insert test", () => {
        const entities = [{id: 123, name: "Bob"}, {id: 124, name: "Alice"}]
        const params = createParams()

        sql.insert(...entities).mapIntoQuery(params)

        assert(params.text.join(''), `(id, name) VALUES ($1, $2), ($3, $4)`)
        assert(params.counter, 5)
        assert(params.args, [123, "Bob", 124, "Alice"])
    })        

    it("undefined behavior test (DEFAULT)", () => {
        const entities = [{id: 123, name: "Bob"}, {id: 124, name: undefined}]
        const params = createParams()

        sql.insert(...entities).mapIntoQuery(params)

        assert(params.text.join(''), `(id, name) VALUES ($1, $2), ($3, DEFAULT)`)
        assert(params.counter, 4)
        assert(params.args, [123, "Bob", 124])
    })

})