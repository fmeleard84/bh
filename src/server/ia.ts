import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Appels au LLM local (Trooper, Gemma 26B) avec sortie JSON contrainte par schéma.
 * Une sortie non conforme est relancée une fois, puis l'erreur remonte (cahier §5).
 * Concurrence bornée : le GPU est partagé avec la Rédaction et les autres services.
 */
const MODELE = process.env.BH_LLM_MODEL ?? "gemma-26b";
const MAX_PARALLELE = Number(process.env.BH_LLM_CONCURRENCE ?? 2);

let enCours = 0;
const attente: (() => void)[] = [];

async function jeton() {
  if (enCours < MAX_PARALLELE) { enCours++; return; }
  await new Promise<void>((r) => attente.push(r));
  enCours++;
}
function rendre() {
  enCours--;
  attente.shift()?.();
}

export async function prompt(nom: string): Promise<string> {
  return readFile(path.join(process.cwd(), "prompts", `${nom}.md`), "utf8");
}

export async function json<T>(opts: { systeme: string; utilisateur: string; schema: object; maxTokens?: number }): Promise<{ data: T; modele: string }> {
  const url = `${process.env.TROOPER_LLM_URL ?? "http://172.18.0.1:17138/v1"}/chat/completions`;
  let derniere: Error | null = null;
  for (let essai = 0; essai < 2; essai++) {
    await jeton();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: MODELE,
          temperature: 0,
          max_tokens: opts.maxTokens ?? 2000,
          messages: [{ role: "system", content: opts.systeme }, { role: "user", content: opts.utilisateur }],
          response_format: { type: "json_schema", json_schema: { name: "sortie", strict: true, schema: opts.schema } },
        }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) throw new Error(`LLM ${res.status} : ${(await res.text()).slice(0, 200)}`);
      const d = (await res.json()) as { choices: { message: { content: string }; finish_reason: string }[] };
      if (d.choices[0].finish_reason === "length") throw new Error("LLM : sortie tronquée");
      return { data: JSON.parse(d.choices[0].message.content) as T, modele: MODELE };
    } catch (e) {
      derniere = e as Error;
    } finally {
      rendre();
    }
  }
  throw derniere!;
}
