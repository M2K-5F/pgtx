import { sql, Pool } from "../src";

const config = { 
    host: 'localhost', 
    user: 'postgres', 
    database: 'pgtx_test', 
    port: 5433, 
    password: 'postgres' 
};

const pool = new Pool(config);
const T_ISO = "test_isolation_table";

async function runIsolationTest() {
    console.log("--- Запуск теста изоляции транзакций ---\n");

    try {
        // 1. Подготовка: Создаем таблицу с нуля
        await pool.query`DROP TABLE IF EXISTS ${sql.ident(T_ISO)}`;
        await pool.query`CREATE TABLE ${sql.ident(T_ISO)} (id SERIAL PRIMARY KEY, val TEXT)`;
        console.log(`✅ Таблица ${T_ISO} создана`);

        const secretVal = `secret_${Date.now()}`;

        // 2. Запускаем транзакцию
        await pool.begin(async (tx) => {
            console.log("🚀 Транзакция началась...");

            // Вставляем данные ВНУТРИ
            await tx.query`INSERT INTO ${sql.ident(T_ISO)} (val) VALUES (${secretVal})`;
            console.log("📝 Данные вставлены (внутри транзакции)");

            // ПРОВЕРКА 1: Видим ли мы их сами?
            const inside = await tx.query`SELECT * FROM ${sql.ident(T_ISO)} WHERE val = ${secretVal}`;
            if (inside.length === 1) {
                console.log("🔍 ПРОВЕРКА 1: Внутри транзакции данные ВИДНЫ (Ок)");
            } else {
                throw new Error("ПРОВЕРКА 1 ПРОВАЛЕНА: Данные не видны внутри!");
            }

            // ПРОВЕРКА 2: Видит ли их кто-то другой (основной пул)?
            const outside = await pool.query`SELECT * FROM ${sql.ident(T_ISO)} WHERE val = ${secretVal}`;
            if (outside.length === 0) {
                console.log("🔍 ПРОВЕРКА 2: Снаружи транзакции данные НЕВИДИМЫ (Изоляция работает)");
            } else {
                throw new Error("ПРОВЕРКА 2 ПРОВАЛЕНА: Утечка данных! Изоляция сломана");
            }

            // 3. Имитируем падение для отката
            console.log("💥 Имитируем ошибку для ROLLBACK...");
            throw new Error("INTENTIONAL_ROLLBACK");
        });

    } catch (err) {
        if (err.message === "INTENTIONAL_ROLLBACK") {
            console.log("↩️  Ошибка поймана, ROLLBACK выполнен автоматически");
        } else {
            console.error("❌ Неожиданная ошибка:", err);
            process.exit(1);
        }
    }

    // 4. Финальная проверка после отката
    const finalCheck = await pool.query`SELECT * FROM ${sql.ident(T_ISO)}`;
    if (finalCheck.length === 0) {
        console.log("\n✨ ИТОГ: Тест пройден! Данные полностью откатились.");
    } else {
        console.error("\n❌ ИТОГ ПРОВАЛЕН: После отката в базе остались данные!");
        process.exit(1);
    }

    await pool.close()
    process.exit(0);
}

runIsolationTest();
