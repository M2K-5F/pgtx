import { arrayClause } from "./src/array.clause";
import { fieldsClause } from "./src/fields.clause";
import { fragmentClause } from "./src/fragment.clause";
import { identClause } from "./src/iden.caluse";
import { PgtxPool } from "./src/pool";
import { staticClause } from "./src/static.clause";
import { updateClause } from "./src/update.clause";
import { valueClause } from "./src/values.clause";

export const sql = {
    insert: valueClause,
    select: fieldsClause,
    update: updateClause,
    ident: identClause,
    literal: staticClause,
    fragment: fragmentClause,
    array: arrayClause,
}

export const Pool = PgtxPool
