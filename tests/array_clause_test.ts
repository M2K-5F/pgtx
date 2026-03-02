import { sql } from '../src';

function assert(actual, expected, message) {
    const sActual = JSON.stringify(actual);
    const sExpected = JSON.stringify(expected);
    
    if (sActual !== sExpected) {
        console.error(`❌ FAIL: ${message}`);
        console.error(`   Got:      ${sActual}`);
        console.error(`   Expected: ${sExpected}`);
        process.exit(1);
    }
    console.log(`✅ PASS: ${message}`);
}

const T_USERS = "users";
const T_ROLES = "roles";

console.log("--- Starting Pgtx Unit Tests (No Dependencies) ---\n");

/**
 * Тест 1: Рекурсивная вложенность (Deep Nesting)
 */
const roleName = 'admin';
const status = 'active';

const filter = sql.fragment`status = ${status}`;
const subQuery = sql.fragment`SELECT id FROM ${sql.ident(T_ROLES)} WHERE ${filter} AND name = ${roleName}`;
const mainQuery = sql.fragment`INSERT INTO ${sql.ident(T_USERS)} (role_id) VALUES ((${subQuery}))`;

const res1 = mainQuery.map(1);

assert(
    res1.text.replace(/\s+/g, ' ').trim(),
    `INSERT INTO "${T_USERS}" (role_id) VALUES ((SELECT id FROM "${T_ROLES}" WHERE status = $1 AND name = $2))`,
    "Deep Nesting SQL string"
);
assert(res1.args, [status, roleName], "Deep Nesting Arguments");


/**
 * Тест 2: Массивы (Array Clause)
 */
const ids = [10, 20];
const res2 = sql.fragment`SELECT * FROM ${sql.ident(T_USERS)} WHERE id IN (${sql.array(ids)})`.map(1);

assert(
    res2.text, 
    `SELECT * FROM "${T_USERS}" WHERE id IN ($1, $2)`, 
    "Array Clause string"
);
assert(res2.args, [10, 20], "Array Clause Arguments");


/**
 * Тест 3: Сложный Upsert (Strategy Pattern Check)
 */
const data = { name: 'Ivan' };
const upData = { login: 'ivan_hero' };

const res3 = sql.fragment`INSERT INTO ${sql.ident(T_USERS)} ${sql.insert(data)} ON CONFLICT DO UPDATE SET ${sql.update(upData)} WHERE id = ${7}`.map(1);

assert(
    res3.text.replace(/\s+/g, ' ').trim(),
    `INSERT INTO "${T_USERS}" (name) VALUES ($1) ON CONFLICT DO UPDATE SET login = $2 WHERE id = $3`,
    "Complex Upsert string"
);
assert(res3.args, ['Ivan', 'ivan_hero', 7], "Complex Upsert Arguments");
