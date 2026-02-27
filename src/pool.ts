import {Pool, PoolConfig} from "pg"
import { Clause } from "./base.clause"

type PoolConf = PoolConfig

class PgtxPool {
    private pool: Pool

    constructor(
        config: PoolConf
    ) {
        this.pool = new Pool(config)
    }

    public execute(strings: TemplateStringsArray, ...values: any[]) {
        const templateLength = strings.length

        let argumentCounter = 1
        
        let query = ''
        let args: any[] = []

        strings.forEach((template, index) => {
            query += template
            if (index === templateLength - 1) return

            const value = values[index]

            if (value instanceof Clause) {
                const result = value.map(argumentCounter)
                argumentCounter = result.counter
                query += result.template
                args.push(...result.args)
            } else {
                args.push(value)
                query += `$${argumentCounter}`
                argumentCounter++
            }
        })

        return {query, args}
    }
}