export abstract class Clause {
    abstract map(currentArgCounter: number): SQLWithArgs
}

export type SQLWithArgs = {template: string, args: any[], counter: number}