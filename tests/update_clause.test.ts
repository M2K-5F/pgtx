import { describe, it } from "node:test"
import { deepEqual as assert } from "node:assert"
import { sql } from "../src"

describe("update clause test", () => {
    const createParams = () => ({
        text: [] as string[],
        args: [] as any[],
    });

    it("update clause test", () => {
        const updateMap = {id: 123, name: "Alice"}
        const params = createParams()

        sql.update(updateMap).mapIntoQuery(params)

        assert(params.text.join(''), `id = $1, name = $2`)
        assert(params.args, [123, "Alice"])
    })

    it("undefined behavior test (SKIP)", () => {
        const updateMap = {id: 123, name: undefined}
        const params = createParams()

        sql.update(updateMap).mapIntoQuery(params)

        assert(params.text.join(''), `id = $1`)
        assert(params.args, [123])
    })
})