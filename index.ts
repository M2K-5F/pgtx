import { fieldsClause } from "./src/fields.clause";
import { PgtxPool } from "./src/pool";
import { staticClause } from "./src/static.clause";
import { updateClause } from "./src/update.clause";
import { valueClause } from "./src/values.clause";

export const sql = {
    insert: valueClause,
    select: fieldsClause,
    update: updateClause,
    literal: staticClause,
}

export const Pool = PgtxPool
