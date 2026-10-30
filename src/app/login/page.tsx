import { redirect } from "next/navigation";
import { login } from "@/server/auth";

async function connexion(form: FormData) {
  "use server";
  const ok = await login(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
  redirect(ok ? "/" : "/login?erreur=1");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const { erreur } = await searchParams;
  return (
    <main className="min-h-screen grid place-items-center px-4">
      <form action={connexion} className="card w-full max-w-sm p-6 space-y-4">
        <div>
          <div className="text-2xl font-bold">BH</div>
          <div className="muted text-sm">Business Hub — Yaoki Lab</div>
        </div>
        {erreur && <div className="pill pill-off">Email ou mot de passe incorrect</div>}
        <input className="input" name="email" type="email" placeholder="Email" required autoComplete="username" />
        <input className="input" name="password" type="password" placeholder="Mot de passe" required autoComplete="current-password" />
        <button className="btn w-full justify-center" type="submit">Se connecter</button>
      </form>
    </main>
  );
}
