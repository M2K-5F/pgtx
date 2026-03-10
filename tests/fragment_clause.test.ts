import { describe, it } from "node:test"
import {deepEqual as assert} from "node:assert"
import { compileSqlTemplate } from "../src/utils"
import { sql } from "../src"

describe("fragment clause test", () => {
    it("simple text test", () => {
        const fragment = sql.fragment`WHERE name = name`

        const result = sql.fragment`SELECT * FROM "users" ${fragment}`.map(1)

        assert(result.text, `SELECT * FROM "users" WHERE name = name`)
        assert(result.argCounter, 1)
        assert(result.args, [])
    })

    it("nesting fragment test", () => {
        const roleCondition = sql.fragment`role_name = ${"admin"}`

        const roleSelect = sql.fragment`SELECT id FROM roles where ${roleCondition} limit ${1}`

        const result = sql.fragment`INSERT INTO users (role_id) VALUES ((${roleSelect})) WHERE id = ${1}`.map(1)

        assert(result.text, "INSERT INTO users (role_id) VALUES ((SELECT id FROM roles where role_name = $1 limit $2)) WHERE id = $3")
        assert(result.argCounter, 4)
        assert(result.args, ["admin", 1, 1])
    })
})