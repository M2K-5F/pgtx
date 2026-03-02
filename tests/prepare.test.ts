import { test, describe } from 'node:test';
import assert from 'node:assert';
import { sql, Pool } from '../src';

const config = { 
    host: 'localhost', 
    user: 'postgres', 
    database: 'pgtx_test', 
    port: 5433, 
    password: 'postgres' 
};

const pool = new Pool(config);
const T_ADV = "test_advanced_features";

describe('Pgtx Advanced Features: Prepared & Savepoints', async () => {

    // Подготовка таблицы
    await pool.query`DROP TABLE IF EXISTS ${sql.ident(T_ADV)}`;
    await pool.query`CREATE TABLE ${sql.ident(T_ADV)} (id SERIAL PRIMARY KEY, name TEXT, balance INT)`;

    test('1. Prepared Statements: Pool Warmup & ? to $n mapping', async () => {
        // Создаем стейтмент через пул
        const stmt = await pool.prepare<{id: number}, [string, number]>(
            'insert_user', 
            'INSERT INTO test_advanced_features (name, balance) VALUES (?, ?) RETURNING id'
        );

        // Выполняем несколько раз (проверяем прогрев пула и маппинг параметров)
        const res1 = await stmt.execute('Alice', 100);
        const res2 = await stmt.execute('Bob', 200);

        assert.strictEqual(res1.length, 1, 'Первая вставка должна вернуть ID');
        assert.strictEqual(res2.length, 1, 'Вторая вставка должна вернуть ID');

        const rows = await pool.query`SELECT count(*) FROM ${sql.ident(T_ADV)}`;
        assert.strictEqual(parseInt(rows[0].count), 2, 'В базе должно быть 2 юзера');
    });

    test('2. Nested Transactions (Savepoints): Selective Rollback', async () => {
        await pool.begin(async (tx) => {
            // 1. Основное действие
            await tx.query`INSERT INTO ${sql.ident(T_ADV)} (name, balance) VALUES (${'Main'}, 500)`;

            // 2. Успешный Savepoint
            await tx.savepoint('sp_success', async (stx) => {
                await stx.query`INSERT INTO ${sql.ident(T_ADV)} (name, balance) VALUES (${'Nested_Ok'}, 10)`;
            });

            // 3. Провальный Savepoint (должен откатить только себя)
            try {
                await tx.savepoint('sp_fail', async (stx) => {
                    await stx.query`INSERT INTO ${sql.ident(T_ADV)} (name, balance) VALUES (${'Nested_Fail'}, 999)`;
                    throw new Error("Rollback this part only");
                });
            } catch (e) {
                // Ошибка ожидаема
            }

            // 4. Еще одно основное действие после фейла вложенного
            await tx.query`INSERT INTO ${sql.ident(T_ADV)} (name, balance) VALUES (${'Post_Fail'}, 100)`;
        });

        // ПРОВЕРКА:
        // 'Main' - должен быть
        // 'Nested_Ok' - должен быть
        // 'Nested_Fail' - НЕ должен быть (откатился сейвпоинт)
        // 'Post_Fail' - должен быть (основная транзакция выжила)
        
        const results = await pool.query`SELECT name FROM ${sql.ident(T_ADV)} ORDER BY id ASC`;
        const names = results.map(r => r.name);

        assert.ok(names.includes('Main'), 'Main query should be committed');
        assert.ok(names.includes('Nested_Ok'), 'Successful savepoint should be committed');
        assert.ok(!names.includes('Nested_Fail'), 'Failed savepoint should be rolled back');
        assert.ok(names.includes('Post_Fail'), 'Query after failed savepoint should be committed');
    });

});
