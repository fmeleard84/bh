import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

/**
 * Applique les fichiers db/migrations/*.sql dans l'ordre, chacun une seule fois
 * et dans sa propre transaction. Pose ensuite le mot de passe du rôle bh_app.
 */
const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const dir = path.join(process.cwd(), "db/migrations");

await sql`create table if not exists public.bh_migrations (nom text primary key, applique_le timestamptz not null default now())`;
const faites = new Set((await sql`select nom from public.bh_migrations`).map((r) => r.nom as string));

for (const nom of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
  if (faites.has(nom)) continue;
  const texte = await readFile(path.join(dir, nom), "utf8");
  await sql.begin(async (tx) => {
    await tx.unsafe(texte);
    await tx`insert into public.bh_migrations (nom) values (${nom})`;
  });
  console.log(`appliquée : ${nom}`);
}

if (process.env.APP_DB_PASSWORD) {
  await sql.unsafe(`alter role bh_app password '${process.env.APP_DB_PASSWORD.replace(/'/g, "''")}'`);
}
await sql.end();
console.log("migrations à jour");
