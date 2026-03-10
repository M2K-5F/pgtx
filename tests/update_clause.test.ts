import { describe, it } from "node:test"
import { deepEqual as assert } from "node:assert"
import { sql } from "../src"

describe("update clause test", () => {
    it("update clause test", () => {
        const updateMap = {id: 123, name: "Alice"}
        const result = sql.update(updateMap).map(1)

        assert(result.text, `id = $1, name = $2`)
        assert(result.args, [123, "Alice"])
        assert(result.argCounter, 3)
    })

    it("undefined behavior test", () => {
        const updateMap = {id: 123, name: undefined}
        const result = sql.update(updateMap).map(1)

        assert(result.text, `id = $1`)
        assert(result.argCounter, 2)
        assert(result.args, [123])
    })
})