import { PoolClient, Pool, QueryResultRow } from "pg";
import { PreparedStatement } from "./types";

export class ConnPraparedStatement<Result extends QueryResultRow, Args extends any[]> {
    constructor(
        private readonly conn: PoolClient,
        readonly text: string,
        readonly name: string
    ) {}

    async execute(...params: Args): Promise<Result[]> {
        return this.conn.query<Result>({
            text: this.text,
            name: this.name,
            values: params
        })
            .then(result => result.rows)
    }
}

export class PoolPreparedStatement<Result extends QueryResultRow, Args extends any[]> implements PreparedStatement<Result, Args> {
    constructor(
        private readonly pool: Pool,
        readonly text: string,
        readonly name: string
    ) {}

    async execute(...params: Args): Promise<Result[]> {
        const conn = await this.pool.connect()

        try {
            return await conn.query<Result>({
                text: this.text,
                name: this.name,
                values: params
            })
                .then(result => result.rows)
        }
        finally {
            conn.release()
        }           
    }   
}

