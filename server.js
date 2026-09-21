/**
 * POS Luxury Backend API Server
 * خادم الواجهة البرمجية لتطبيق نقاط البيع والربط مع MySQL
 */
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// إعداد الاتصال بقاعدة بيانات MySQL
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pos_db',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
    ssl: (process.env.DB_SSL === 'true' || process.env.DB_PORT == '4000' || (process.env.DB_HOST && process.env.DB_HOST.includes('tidbcloud')))
        ? { minVersion: 'TLSv1.2', rejectUnauthorized: true }
        : undefined
};

const pool = mysql.createPool(dbConfig);

// اختبار الاتصال عند التشغيل
pool.getConnection()
    .then(connection => {
        console.log('✅ تم الاتصال بنجاح بقاعدة بيانات MySQL');
        connection.release();
    })
    .catch(err => {
        console.error('❌ خطأ في الاتصال بقاعدة بيانات MySQL:', err.message);
    });

// فحص الحالة الصحية للخادم (Health Check)
app.get('/', (req, res) => {
    res.json({ status: 'running', message: 'POS Luxury API is online' });
});

/**
 * 1. مزامنة فواتير المبيعات
 * POST /api/v1/sync/sales
 */
app.post('/api/v1/sync/sales', async (req, res) => {
    const salesList = req.body;
    if (!Array.isArray(salesList)) {
        return res.status(400).json({ error: 'Expected array of sales' });
    }

    const results = [];
    const connection = await pool.getConnection();

    try {
        for (const sale of salesList) {
            try {
                await connection.beginTransaction();

                // التحقق مما إذا كانت الفاتورة مسجلة مسبقاً برقم الفاتورة
                const [existing] = await connection.query(
                    'SELECT id FROM sales WHERE invoice_number = ? LIMIT 1',
                    [sale.invoice_number]
                );

                if (existing.length > 0) {
                    await connection.commit();
                    results.push({
                        local_id: sale.local_id,
                        server_id: existing[0].id,
                        status: 'SUCCESS',
                        message: 'الفاتورة مسجلة مسبقاً على السيرفر'
                    });
                    continue;
                }

                // إدراج الفاتورة في جدول sales
                const [saleResult] = await connection.query(
                    `INSERT INTO sales (
                        local_id, invoice_number, invoice_timestamp, total_amount, 
                        discount, payment_type, treasury_id, customer_id, 
                        paid_amount, remaining_debt
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        sale.local_id,
                        sale.invoice_number,
                        sale.timestamp,
                        sale.total_amount,
                        sale.discount || 0,
                        sale.payment_type || 'CASH',
                        sale.treasury_id || null,
                        sale.customer_id || null,
                        sale.paid_amount || 0,
                        sale.remaining_debt || 0
                    ]
                );

                const serverSaleId = saleResult.insertId;

                // إدراج بنود الفاتورة وتحديث المخزون
                if (sale.items && Array.isArray(sale.items)) {
                    for (const item of sale.items) {
                        await connection.query(
                            `INSERT INTO sale_items (
                                sale_id, barcode, product_name, quantity, unit_price, unit_cost
                            ) VALUES (?, ?, ?, ?, ?, ?)`,
                            [
                                serverSaleId,
                                item.barcode || '',
                                item.product_name,
                                item.quantity,
                                item.unit_price,
                                item.unit_cost || 0
                            ]
                        );

                        // خصم الكمية المباعة من مخزون السيرفر إذا كان الباركود مسجلاً
                        if (item.barcode) {
                            await connection.query(
                                `UPDATE products 
                                 SET stock_quantity = stock_quantity - ?, updated_at = NOW() 
                                 WHERE barcode = ?`,
                                [item.quantity, item.barcode]
                            );
                        }
                    }
                }

                // تحديث رصيد الخزينة بالمبلغ المدفوع كاش
                if (sale.treasury_id && sale.paid_amount > 0) {
                    await connection.query(
                        `UPDATE treasuries 
                         SET balance = balance + ?, updated_at = NOW() 
                         WHERE id = ?`,
                        [sale.paid_amount, sale.treasury_id]
                    );
                }

                // تحديث ديون العميل إذا كان هناك دين متبقٍ
                if (sale.customer_id && sale.remaining_debt > 0) {
                    await connection.query(
                        `UPDATE customers 
                         SET total_debt = total_debt + ?, updated_at = NOW() 
                         WHERE id = ?`,
                        [sale.remaining_debt, sale.customer_id]
                    );
                }

                await connection.commit();

                results.push({
                    local_id: sale.local_id,
                    server_id: serverSaleId,
                    status: 'SUCCESS',
                    message: 'تمت مزامنة الفاتورة بنجاح'
                });
            } catch (itemErr) {
                await connection.rollback();
                console.error('خطأ في مزامنة فاتورة:', itemErr.message);
                results.push({
                    local_id: sale.local_id,
                    server_id: 0,
                    status: 'ERROR',
                    message: itemErr.message
                });
            }
        }

        res.json(results);
    } finally {
        connection.release();
    }
});

/**
 * 2. مزامنة المصروفات وسندات الصرف
 * POST /api/v1/sync/expenses
 */
app.post('/api/v1/sync/expenses', async (req, res) => {
    const expensesList = req.body;
    if (!Array.isArray(expensesList)) {
        return res.status(400).json({ error: 'Expected array of expenses' });
    }

    const results = [];
    const connection = await pool.getConnection();

    try {
        for (const exp of expensesList) {
            try {
                await connection.beginTransaction();

                const [expResult] = await connection.query(
                    `INSERT INTO expenses (
                        local_id, title, amount, category, treasury_id, expense_timestamp
                    ) VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        exp.local_id,
                        exp.title,
                        exp.amount,
                        exp.category || 'متنوع',
                        exp.treasury_id || null,
                        exp.timestamp
                    ]
                );

                const serverExpId = expResult.insertId;

                // خصم مبلغ المصروف من الخزينة المسحوب منها
                if (exp.treasury_id && exp.amount > 0) {
                    await connection.query(
                        `UPDATE treasuries 
                         SET balance = balance - ?, updated_at = NOW() 
                         WHERE id = ?`,
                        [exp.amount, exp.treasury_id]
                    );
                }

                await connection.commit();

                results.push({
                    local_id: exp.local_id,
                    server_id: serverExpId,
                    status: 'SUCCESS',
                    message: 'تمت مزامنة المصروف بنجاح'
                });
            } catch (err) {
                await connection.rollback();
                console.error('خطأ في مزامنة المصروف:', err.message);
                results.push({
                    local_id: exp.local_id,
                    server_id: 0,
                    status: 'ERROR',
                    message: err.message
                });
            }
        }

        res.json(results);
    } finally {
        connection.release();
    }
});

/**
 * 3. جلب تحديثات المنتجات من السيرفر إلى التطبيق
 * GET /api/v1/sync/products?since=0
 */
app.get('/api/v1/sync/products', async (req, res) => {
    const sinceTimestamp = parseInt(req.query.since || '0', 10);

    try {
        let query = `
            SELECT 
                id AS server_id,
                barcode,
                name,
                packaging,
                stock_quantity,
                cost_price,
                sale_price,
                UNIX_TIMESTAMP(updated_at) * 1000 AS updated_at
            FROM products
        `;
        const params = [];

        if (sinceTimestamp > 0) {
            query += ` WHERE UNIX_TIMESTAMP(updated_at) * 1000 > ?`;
            params.push(sinceTimestamp);
        }

        query += ` ORDER BY updated_at ASC`;

        const [rows] = await pool.query(query, params);

        res.json({
            products: rows.map(p => ({
                server_id: p.server_id,
                barcode: p.barcode,
                name: p.name,
                packaging: p.packaging,
                stock_quantity: parseFloat(p.stock_quantity),
                cost_price: parseFloat(p.cost_price),
                sale_price: parseFloat(p.sale_price),
                updated_at: parseInt(p.updated_at, 10)
            })),
            server_timestamp: Date.now()
        });
    } catch (err) {
        console.error('خطأ في جلب المنتجات:', err.message);
        res.status(500).json({ error: 'فشل جلب المنتجات من السيرفر' });
    }
});

/**
 * 4. رفع وتحديث المنتجات من التطبيق إلى السيرفر
 * POST /api/v1/sync/products
 */
app.post('/api/v1/sync/products', async (req, res) => {
    const products = req.body;
    if (!Array.isArray(products)) {
        return res.status(400).json({ error: 'المتوقع مصفوفة من المنتجات' });
    }

    const connection = await pool.getConnection();
    const results = [];

    try {
        for (const p of products) {
            try {
                // فحص وجود المنتج مسبقاً بنفس الباركود
                const [existing] = await connection.query(
                    'SELECT id FROM products WHERE barcode = ? LIMIT 1',
                    [p.barcode]
                );

                let serverId;
                if (existing.length > 0) {
                    serverId = existing[0].id;
                    await connection.query(
                        `UPDATE products 
                         SET name = ?, packaging = ?, stock_quantity = ?, cost_price = ?, sale_price = ?, updated_at = NOW() 
                         WHERE id = ?`,
                        [p.name, p.packaging || 'حبة', p.stock_quantity || 0, p.cost_price || 0, p.sale_price || 0, serverId]
                    );
                } else {
                    const [insertResult] = await connection.query(
                        `INSERT INTO products (barcode, name, packaging, stock_quantity, cost_price, sale_price, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                        [p.barcode, p.name, p.packaging || 'حبة', p.stock_quantity || 0, p.cost_price || 0, p.sale_price || 0]
                    );
                    serverId = insertResult.insertId;
                }

                results.push({
                    local_id: p.local_id,
                    server_id: serverId,
                    status: 'SUCCESS',
                    message: 'تمت مزامنة المنتج بنجاح'
                });
            } catch (pErr) {
                console.error('خطأ في مزامنة منتج:', pErr.message);
                results.push({
                    local_id: p.local_id,
                    server_id: 0,
                    status: 'ERROR',
                    message: pErr.message
                });
            }
        }

        res.json(results);
    } finally {
        connection.release();
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 خادم POS يعمل الآن على المنفذ http://localhost:${PORT}`);
});
