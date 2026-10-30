import postgres from "postgres";

/**
 * Deux connexions :
 *  - sysSql : propriétaire du schéma, sans RLS. Réservé au worker, à l'authentification
 *    et aux scripts. Jamais utilisé pour servir une donnée à un utilisateur.
 *  - asUser : rôle bh_app, la RLS s'applique ; l'utilisateur courant est posé
 *    pour la durée de la transaction (set_config local).
 */
const g = globalThis as unknown as { __sys?: postgres.Sql; __app?: postgres.Sql };

export function sysSql(): postgres.Sql {
  g.__sys ??= postgres(process.env.DATABASE_URL!, { max: 5, onnotice: () => {} });
  return g.__sys;
}

function appSql(): postgres.Sql {
  g.__app ??= postgres(process.env.APP_DATABASE_URL!, { max: 10, onnotice: () => {} });
  return g.__app;
}

export async function asUser<T>(userId: string, fn: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return appSql().begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
