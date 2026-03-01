import { sql, Pool } from "../index.js";

const config = { /* твой конфиг */ host: 'localhost', user: 'postgres', database: 'pgtx_test', port: 5433, password: 'postgres' };
const pool = new Pool(config);

const T_TX = "test_transactions";

async function runTxTests() {
    console.log("--- Starting Transaction Tests ---\n");

    await pool.query`DROP TABLE IF EXISTS ${sql.ident(T_TX)}`;
    await pool.query`CREATE TABLE ${sql.ident(T_TX)} (id SERIAL PRIMARY KEY, val TEXT)`;

    /**
     * ТЕСТ 1: Успешный COMMIT
     */
    await pool.begin(async (tx) => {
        await tx.query`INSERT INTO ${sql.ident(T_TX)} (val) VALUES (${'success'})`;
        await tx.query`INSERT INTO ${sql.ident(T_TX)} (val) VALUES (${'stable'})`;
    });

    const rows = await pool.query`SELECT count(*) FROM ${sql.ident(T_TX)}`;
    if (parseInt(rows[0].count) === 2) {
        console.log("✅ PASS: Commit successful (2 rows found)");
    } else {
        console.error("❌ FAIL: Commit failed");
        process.exit(1);
    }

    /**
     * ТЕСТ 2: Автоматический ROLLBACK при ошибке
     */
    try {
        await pool.begin(async (tx) => {
            await tx.query`INSERT INTO ${sql.ident(T_TX)} (val) VALUES (${'should_rollback'})`;
            // Имитируем падение логики
            throw new Error("BOOM");
        });
    } catch (e) {
        if (e.message === "BOOM") {
            const check = await pool.query`SELECT * FROM ${sql.ident(T_TX)} WHERE val = ${'should_rollback'}`;
            if (check.length === 0) {
                console.log("✅ PASS: Rollback successful (row not found after error)");
            } else {
                console.error("❌ FAIL: Rollback failed, data leaked into DB");
                process.exit(1);
            }
        }
    }

    /**
     * ТЕСТ 3: Вложенные фрагменты ВНУТРИ транзакции
     */
    await pool.begin(async (tx) => {
        const sub = sql.fragment`INSERT INTO ${sql.ident(T_TX)} (val) VALUES (${'nested_tx'})`;
        await tx.query`${sub}`; 
    });
    
    const nestedCheck = await pool.query`SELECT * FROM ${sql.ident(T_TX)} WHERE val = ${'nested_tx'}`;
    if (nestedCheck.length === 1) {
        console.log("✅ PASS: Nested fragments work inside transactions");
    }

    console.log("\n✨ All transaction tests passed!");
    process.exit(0);
}

runTxTests().catch(err => {
    console.error("💥 Unexpected error:", err);
    process.exit(1);
});

