import { QueryText, StatementName } from "./connection";
import { ColumnDescription, ValueOF } from "./types";


export const QueryState = {
    Parsing: 0,
    Describing: 1,
    Executing: 2,
    Completed: 3,
    Failed: 4
} as const


export type State = ValueOF<typeof QueryState>


export class Query<T> {
    promise: Promise<T[]>
    resolve!: (value: T[]) => void
    reject!: (error: Error) => void
    rows: any[][] = []

    constructor(
        public text: QueryText,
        public args: (string | null)[],
        public state: State,
        public statementName: StatementName,
        public columns?: ColumnDescription[]
    )  {
        this.promise = new Promise<T[]>((a, b) => {
            this.resolve = a
            this.reject = b
        })
    }

    setState(state: State) {
        this.state = state
    }

    toObjects(): T[] {
        if (!this.rows.length || !this.columns || !this.columns.length) {
            return [] as T[]
        }

        const result: T[] = []
        const rowsLength = this.rows.length
        const columnsLength = this.columns.length

        const colNames = new Array<string>(columnsLength)
        for (let c = 0; c < columnsLength; c++) {
            colNames[c] = this.columns[c].name
        }

        for (let r = 0; r < rowsLength; r++) {
            const rawRow = this.rows[r];
            const rowObject: Record<string, any> = {}

            for (let c = 0; c < columnsLength; c++) {
                rowObject[colNames[c]] = rawRow[c]
            }

            result.push(rowObject as T)
        }

        return result;
    }
}