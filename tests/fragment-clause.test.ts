import { describe, it } from "node:test"
import {deepEqual as assert} from "node:assert"
import { sql } from "../src"

describe("fragment clause test", () => {
    const createParams = () => ({
        text: "",
        args: [] as any[],
    })

    it("simple text test", () => {
        const fragment = sql.fragment`WHERE name = name`
        const params = createParams()

        sql.fragment`SELECT * FROM "users" ${fragment}`.mapIntoQuery(params)

        assert(params.text, `SELECT * FROM "users" WHERE name = name`)
        assert(params.args, [])
    })

    it("nesting fragment test", () => {
        const roleCondition = sql.fragment`role_name = ${"admin"}`
        const roleSelect = sql.fragment`SELECT id FROM roles where ${roleCondition} limit ${1}`
        
        const params = createParams()

        sql.fragment`INSERT INTO users (role_id) VALUES ((${roleSelect})) WHERE id = ${1}`
            .mapIntoQuery(params)

        assert(
            params.text, 
            "INSERT INTO users (role_id) VALUES ((SELECT id FROM roles where role_name = $1 limit $2)) WHERE id = $3"
        )
        assert(params.args, ["admin", "1", "1"])
    })
})