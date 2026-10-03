import postgres from "postgres";

const globalForPostgres = globalThis as unknown as { sql?: postgres.Sql };

/**
 * Shared PostgreSQL client, created on first use so that builds without
 * DATABASE_URL still succeed. Server-side only.
 *
 * TLS is required unless the URL says `sslmode=disable` (local containers).
 */
export function db(): postgres.Sql {
    if (globalForPostgres.sql) return globalForPostgres.sql;

    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");

    globalForPostgres.sql = postgres(url, {
        // Transaction-mode poolers (Supabase, PgBouncer) do not support prepared statements
        prepare: false,
        ssl: /sslmode=disable/.test(url) ? false : "require",
    });
    return globalForPostgres.sql;
}
