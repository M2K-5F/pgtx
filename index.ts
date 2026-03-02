import { arrayClause } from "./src/clauses/array.clause";
import { fragmentClause } from "./src/clauses/fragment.clause";
import { identClause } from "./src/clauses/iden.caluse";
import { Pool as PgtxPool } from "./src/pool";
import { staticClause } from "./src/clauses/static.clause";
import { updateClause } from "./src/clauses/update.clause";
import { valueClause } from "./src/clauses/values.clause";  

export const sql = {
    insert: valueClause,
    update: updateClause,
    ident: identClause,
    literal: staticClause,
    fragment: fragmentClause,
    array: arrayClause,
}

export const Pool = PgtxPool
