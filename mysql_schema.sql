-- ==========================================================
-- نظام نقاط البيع (POS Luxury System)
-- هيكل قاعدة بيانات MySQL المتوافقة كلياً مع التطبيق
-- ترمز الترميز: utf8mb4 لدعم اللغة العربية والرموز التعبيرية
-- ==========================================================




-- ----------------------------------------------------------
-- 1. جدول الخزائن والصناديق (Treasuries)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `treasuries` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(191) NOT NULL COMMENT 'اسم الخزينة أو الصندوق',
    `balance` DECIMAL(15, 2) NOT NULL DEFAULT 0.00 COMMENT 'الرصيد الحالي',
    `is_default` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'هل هي الخزينة الافتراضية',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- بيانات أولية افتراضية للخزينة
INSERT INTO `treasuries` (`id`, `name`, `balance`, `is_default`) 
VALUES (1, 'الخزينة الرئيسية (الكاشير)', 0.00, 1)
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`);

-- ----------------------------------------------------------
-- 2. جدول العملاء والديون (Customers)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `customers` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(191) NOT NULL COMMENT 'اسم العميل',
    `phone` VARCHAR(50) NOT NULL UNIQUE COMMENT 'رقم الهاتف (فريد)',
    `total_debt` DECIMAL(15, 2) NOT NULL DEFAULT 0.00 COMMENT 'إجمالي الديون المستحقة',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_customer_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------
-- 3. جدول المنتجات والمخزون (Products)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `products` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `barcode` VARCHAR(100) NOT NULL UNIQUE COMMENT 'باركود المنتج',
    `name` VARCHAR(255) NOT NULL COMMENT 'اسم المنتج',
    `packaging` VARCHAR(50) NOT NULL DEFAULT 'حبة' COMMENT 'وحدة التعبئة (حبة، كرتون، كجم)',
    `stock_quantity` DECIMAL(12, 3) NOT NULL DEFAULT 0.000 COMMENT 'كمية المخزون المتوفرة',
    `cost_price` DECIMAL(15, 2) NOT NULL DEFAULT 0.00 COMMENT 'سعر التكلفة',
    `sale_price` DECIMAL(15, 2) NOT NULL DEFAULT 0.00 COMMENT 'سعر البيع',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_product_barcode` (`barcode`),
    INDEX `idx_product_updated_at` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------
-- 4. جدول فواتير المبيعات (Sales)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sales` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `local_id` BIGINT UNSIGNED NULL COMMENT 'رقم الفاتورة على جهاز الكاشير المحلي',
    `invoice_number` VARCHAR(100) NOT NULL UNIQUE COMMENT 'رقم الفاتورة الفريد',
    `invoice_timestamp` BIGINT NOT NULL COMMENT 'تاريخ ووقت الفاتورة بالمللي ثانية',
    `total_amount` DECIMAL(15, 2) NOT NULL COMMENT 'إجمالي الفاتورة بعد الخصم',
    `discount` DECIMAL(15, 2) NOT NULL DEFAULT 0.00 COMMENT 'قيمة الخصم',
    `payment_type` ENUM('CASH', 'DEBT', 'SPLIT') NOT NULL DEFAULT 'CASH' COMMENT 'طريقة الدفع: كاش، آجل، مجزأ',
    `treasury_id` BIGINT UNSIGNED NULL COMMENT 'الخزينة المودع بها المبلغ',
    `customer_id` BIGINT UNSIGNED NULL COMMENT 'العميل في حال البيع الآجل أو المحدد',
    `paid_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0.00 COMMENT 'المبلغ المدفوع كاش',
    `remaining_debt` DECIMAL(15, 2) NOT NULL DEFAULT 0.00 COMMENT 'المبلغ المتبقي كدين',
    `device_name` VARCHAR(100) NULL COMMENT 'اسم جهاز الكاشير',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_sales_treasury` FOREIGN KEY (`treasury_id`) REFERENCES `treasuries` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_sales_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL,
    INDEX `idx_sales_invoice_number` (`invoice_number`),
    INDEX `idx_sales_timestamp` (`invoice_timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------
-- 5. جدول بنود الفاتورة (Sale Items)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sale_items` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `sale_id` BIGINT UNSIGNED NOT NULL COMMENT 'معرف الفاتورة التابع لها',
    `barcode` VARCHAR(100) NULL COMMENT 'باركود الصنف',
    `product_name` VARCHAR(255) NOT NULL COMMENT 'اسم المنتج المباع',
    `quantity` DECIMAL(12, 3) NOT NULL COMMENT 'الكمية المباعة',
    `unit_price` DECIMAL(15, 2) NOT NULL COMMENT 'سعر بيع الوحدة',
    `unit_cost` DECIMAL(15, 2) NOT NULL DEFAULT 0.00 COMMENT 'سعر تكلفة الوحدة',
    CONSTRAINT `fk_sale_items_sale` FOREIGN KEY (`sale_id`) REFERENCES `sales` (`id`) ON DELETE CASCADE,
    INDEX `idx_sale_items_sale_id` (`sale_id`),
    INDEX `idx_sale_items_barcode` (`barcode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------
-- 6. جدول سندات الصرف والمصروفات (Expenses)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `expenses` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `local_id` BIGINT UNSIGNED NULL COMMENT 'رقم السند المحلي',
    `title` VARCHAR(255) NOT NULL COMMENT 'بيان المصروف أو وصفه',
    `amount` DECIMAL(15, 2) NOT NULL COMMENT 'مبلغ الصرف',
    `category` VARCHAR(100) NOT NULL DEFAULT 'متنوع' COMMENT 'تصنيف المصروف (إيجار، فواتير، رواتب، صيانة، متنوع)',
    `treasury_id` BIGINT UNSIGNED NULL COMMENT 'الخزينة المسحوب منها المبلغ',
    `expense_timestamp` BIGINT NOT NULL COMMENT 'تاريخ ووقت الصرف بالمللي ثانية',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_expenses_treasury` FOREIGN KEY (`treasury_id`) REFERENCES `treasuries` (`id`) ON DELETE SET NULL,
    INDEX `idx_expenses_timestamp` (`expense_timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------
-- 7. جدول سجل المزامنة (Sync Logs - اختياري للمراقبة)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sync_logs` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `action` VARCHAR(50) NOT NULL COMMENT 'نوع العملية: sync_sales, sync_expenses, fetch_products',
    `items_count` INT NOT NULL DEFAULT 0,
    `status` VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
    `details` TEXT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
