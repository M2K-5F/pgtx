import { describe, it } from "node:test"
import { deepEqual as assert } from "node:assert"
import { sql } from "../src"

describe("insert clause test", () => {
    it("insert test", () => {
        const entities = [{id: 123, name: "Bob"}, {id: 124, name: "Alice"}]
        const result = sql.insert(...entities).map(1)

        assert(result.text, `(id, name) VALUES ($1, $2), ($3, $4)`)
        assert(result.argCounter, 5)
        assert(result.args, [123, "Bob", 124, "Alice"])
    })        

    it("undefined behavior test", () => {
        const entities = [{id: 123, name: "Bob"}, {id: 124, name: undefined}]
        const result = sql.insert(...entities).map(1)

        assert(result.text, `(id, name) VALUES ($1, $2), ($3, DEFAULT)`)
        assert(result.argCounter, 4)
        assert(result.args, [123, "Bob", 124])
    })
}) 