INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '2fe228d28c8fc212f62ba0b2a220e98a37aadbf80b4545010b99cb8b8a6b2c5c', 1785868560000
WHERE NOT EXISTS (
	SELECT 1
	FROM drizzle.__drizzle_migrations
	WHERE created_at = 1785868560000
);
