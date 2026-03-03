import { Pool, sql } from "../src";

const pool = new Pool({ 
    host: 'localhost', 
    user: 'postgres', 
    database: 'pgtx_test', 
    port: 5433, 
    password: 'postgres' 
})

// pool.query`create table if not exists undefined_behaviour_test_not_null (
//     id serial primary key,
//     name text not null,
//     age int default 18
// );`

pool.query`update undefined_behaviour_test_not_null set ${sql.update({name: "name_updated_second", age: undefined})}`
