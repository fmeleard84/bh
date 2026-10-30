import { describe, expect, it } from "vitest";
import { communeNormalisee, domainePertinent, domainesCandidats, estAnnuaire, liensUtiles, prouver, telephone, type Identite } from "../src/server/flux/verification";
import { trancheDansBornes, nomPropre, premierPrenom } from "../src/server/texte";

describe("preuve d'identité d'un site", () => {
  const id = (o: Partial<Identite>): Identite => ({ siren: "000000000", commune: null, dirigeants: [], ...o });

  it("accepte le SIREN, même espacé ou dans un SIRET, quel que soit le domaine", () => {
    expect(prouver("RCS Aix 812 985 331", "https://x.fr/", id({ siren: "812985331" })).verifie).toBe(true);
    expect(prouver("SIRET : 812.985.331.00024", "https://x.fr/", id({ siren: "812985331" })).verifie).toBe(true);
  });

  it("vrais positifs du pilote", () => {
    const trinh = id({ commune: "FONTVIEILLE", raisonSociale: "AGENCE JULIEN TRINH", dirigeants: [{ prenom: "Julien", nom: "Trinh" }] });
    expect(prouver("L'agence Vin, c'est Claire et Julien Trinh, à Fontvieille", "https://agence.vin/", trinh).verifie).toBe(true);
    const reves = id({ commune: "AVIGNON", raisonSociale: "REVES DE VINS", dirigeants: [{ prenom: "Herve", nom: "Rault" }] });
    expect(prouver("Hervé Rault, Avignon", "https://revesdevins.com/", reves).verifie).toBe(true);
    const vinisim = id({ commune: "ARLES", raisonSociale: "VINISIM", dirigeants: [{ prenom: "Simon", nom: "Chiuppi" }] });
    expect(prouver("Vinisim, agence fondée par Simon CHIUPPI", "https://www.vinisim.fr/", vinisim).verifie).toBe(true);
  });

  it("faux positifs de l'audit du 2026-10-30", () => {
    // Nom de famille courant + même ville, sans le prénom.
    const martinez = id({ commune: "PERPIGNAN", dirigeants: [{ prenom: "Lucien", nom: "Martinez" }] });
    expect(prouver("Garage Martinez, Perpignan", "https://www.garage-martinez-perpignan.fr/", martinez).verifie).toBe(false);
    // Nom de famille qui est aussi un mot, sur un site sans rapport.
    const paris = id({ commune: "TOULOUSE", dirigeants: [{ prenom: "Tom", nom: "Paris" }] });
    expect(prouver("Concert Tom Paris à Toulouse", "https://kelbillet.com/", paris).verifie).toBe(false);
    // Site d'une mairie qui cite une élue homonyme.
    const lasserre = id({ commune: "MARIGNAC-LASPEYRES", dirigeants: [{ prenom: "Nathalie", nom: "Lasserre" }] });
    expect(prouver("Conseil municipal : Nathalie Lasserre. Marignac-Laspeyres", "https://marignac-laspeyres.fr/", lasserre).verifie).toBe(false);
    // Raison sociale identique au nom du dirigeant : ne prouve rien.
    const thierry = id({ commune: "PERPIGNAN", raisonSociale: "THIERRY", dirigeants: [{ prenom: "Paul", nom: "Thierry" }] });
    expect(prouver("Paul Thierry, Thierry conseil", "https://thierry.fr/", thierry).verifie).toBe(false);
  });

  it("ramène un arrondissement à sa commune", () => {
    expect(communeNormalisee("MARSEILLE 8")).toBe("marseille");
    expect(communeNormalisee("AIX-EN-PROVENCE")).toBe("aix en provence");
  });

  it("juge la pertinence d'un domaine", () => {
    const i = id({ raisonSociale: "WINEMAKERS ROCK", dirigeants: [{ prenom: "James", nom: "Wood" }] });
    expect(domainePertinent("https://winemakersrock.com/", i)).toBe(true);
    expect(domainePertinent("https://www.ouigo.com/", i)).toBe(false);
  });
});

describe("candidats et filtres", () => {
  it("devine des domaines sans forme juridique", () => {
    expect(domainesCandidats(["VINETIK SAS"])).toEqual(["vinetik.fr", "vinetik.com"]);
    expect(domainesCandidats(["SARL REVES DE VINS"])).toContain("reves-vins.fr");
    expect(domainesCandidats(["ENTRECAVISTES.COM"])[0]).toBe("entrecavistes.com");
  });

  it("écarte les annuaires", () => {
    expect(estAnnuaire("www.societe.com")).toBe(true);
    expect(estAnnuaire("fr.linkedin.com")).toBe(true);
    expect(estAnnuaire("vinetik.com")).toBe(false);
  });

  it("met les mentions légales en premier et reste sur le site", () => {
    const l = liensUtiles(
      [{ href: "https://a.fr/contact", texte: "Contact" }, { href: "https://a.fr/mentions-legales", texte: "" }, { href: "https://b.fr/mentions", texte: "" }],
      "www.a.fr",
    );
    expect(l).toEqual(["https://a.fr/mentions-legales", "https://a.fr/contact"]);
  });

  it("lit un téléphone français", () => {
    expect(telephone("Tél. : 06.23.49.01.12")).toBe("06 23 49 01 12");
    expect(telephone("+33 4 90 12 34 56")).toBe("04 90 12 34 56");
    expect(telephone("SIREN 812985331")).toBeNull();
  });
});

describe("registre", () => {
  it("respecte les bornes d'effectif, non renseigné compris", () => {
    expect(trancheDansBornes(null, "NN", "03")).toBe(true);
    expect(trancheDansBornes("03", "NN", "03")).toBe(true);
    expect(trancheDansBornes("11", "NN", "03")).toBe(false);
  });

  it("met les noms en forme", () => {
    expect(nomPropre("LANTUECH (LANTUECH)")).toBe("Lantuech");
    expect(premierPrenom("HERVE CHRISTOPHE ANDRE")).toBe("Herve");
    expect(nomPropre("DUPONT-MOREAU")).toBe("Dupont-Moreau");
  });
});

describe("garde-fous de l'Extracteur", async () => {
  const { citationPresente, nombreJustifie } = await import("../src/server/flux/f3-extraire");
  it("ne garde une citation que si elle est dans la page", () => {
    expect(citationPresente("L’agence Vin, représente de grands vignerons", "Bienvenue. L'agence Vin, représente de grands vignerons !")).toBe(true);
    expect(citationPresente("représente 40 domaines", "représente de grands vignerons")).toBe(false);
  });
  it("ne garde un nombre que s'il est justifié", () => {
    expect(nombreJustifie("equipe", 2, "La sélection : 6 vins")).toBe(false);
    expect(nombreJustifie("nb_domaines", 38, "nous représentons 38 producteurs")).toBe(true);
    expect(nombreJustifie("nb_domaines", 3, "Domaine A, Domaine B, Domaine C")).toBe(true);
    expect(nombreJustifie("equipe", 12, "112 clients")).toBe(false);
  });
});

describe("motifs d'email", async () => {
  const { motifs } = await import("../src/server/flux/f4-contacts");
  it("produit les motifs français usuels, sans accents", () => {
    const m = motifs("Hervé", "Rault", "revesdevins.com");
    expect(m[0]).toBe("herve.rault@revesdevins.com");
    expect(m).toContain("hrault@revesdevins.com");
    expect(motifs("Jean-Pierre", "Le Goff", "x.fr")[0]).toBe("jeanpierre.legoff@x.fr");
  });
});

describe("adresses masquées", async () => {
  const { desobfusquer } = await import("../src/server/flux/f4-contacts");
  it("remet au format normal", () => {
    expect(desobfusquer("contact[@]parcellair.com")).toBe("contact@parcellair.com");
    expect(desobfusquer("commercial[at]dis-vin.fr")).toBe("commercial@dis-vin.fr");
    expect(desobfusquer("jean (at) vins (dot) fr")).toBe("jean@vins.fr");
    expect(desobfusquer("Julien@Agence.vin")).toBe("julien@agence.vin");
  });
});

describe("contrôle de gabarit", async () => {
  const { controler } = await import("../src/server/flux/gabarit");
  const ctx = { prenom: "Julien", constats: ["Votre agence représente 16 domaines de 8 régions."], autres: "atelier visio 40 min, 10 agents" };
  it("accepte un J0 conforme", () => {
    const c = controler("j0", { objet: "vos 16 domaines", corps: "Bonjour Julien, votre agence représente 16 domaines de 8 régions. Seriez-vous ouvert à en parler ?" }, ctx);
    expect(c.defauts).toEqual([]);
  });
  it("refuse un chiffre inventé, un faux « re: », un lien, deux questions", () => {
    const c = controler("j0", { objet: "re: vos domaines", corps: "Bonjour Julien, vos 40 domaines et 25 cavistes ? Voir www.x.fr. Intéressé ?" }, ctx);
    expect(c.defauts.join(" | ")).toMatch(/chiffre.*25/);
    expect(c.defauts.join(" | ")).toMatch(/imite une réponse/);
    expect(c.defauts.join(" | ")).toMatch(/lien/);
    expect(c.defauts.join(" | ")).toMatch(/une question/);
  });
  it("refuse le tutoiement et les superlatifs", () => {
    const c = controler("j7", { objet: "une idée", corps: "Bonjour Julien, ton agence est la meilleure !" }, ctx);
    expect(c.defauts.join(" | ")).toMatch(/tutoiement/);
    expect(c.defauts.join(" | ")).toMatch(/superlatif/);
  });
});

describe("réponses entrantes", async () => {
  const { estOpposition, sansCitation } = await import("../src/server/flux/f7-reponses");
  it("détecte une opposition sans IA", () => {
    expect(estOpposition("STOP")).toBe(true);
    expect(estOpposition("Merci de ne plus me contacter.")).toBe(true);
    expect(estOpposition("Désinscrivez-moi svp")).toBe(true);
    expect(estOpposition("Oui, appelez-moi mardi. Je ne veux pas stopper la discussion.")).toBe(false);
  });
  it("retire la citation du message d'origine", () => {
    expect(sansCitation("Oui volontiers.\n\nLe 30 oct. 2026 à 10:00, Vincent a écrit :\n> Bonjour")).toBe("Oui volontiers.");
  });
});

describe("fenêtre d'envoi", async () => {
  const { dansFenetre, prochaineFenetre, jetonDesinscription, lireJeton } = await import("../src/server/flux/envoi");
  it("du lundi au vendredi, 8 h - 18 h à Paris", () => {
    expect(dansFenetre(new Date("2026-11-02T09:00:00+01:00"))).toBe(true);  // lundi 9 h
    expect(dansFenetre(new Date("2026-11-02T18:30:00+01:00"))).toBe(false); // lundi 18 h 30
    expect(dansFenetre(new Date("2026-10-31T10:00:00+01:00"))).toBe(false); // samedi
    expect(prochaineFenetre(new Date("2026-10-31T10:00:00+01:00")).toISOString()).toBe("2026-11-02T07:00:00.000Z"); // lundi 8 h
  });
  it("jeton de désinscription infalsifiable", () => {
    process.env.SESSION_SECRET ??= "test";
    const j = jetonDesinscription("3f1c-contact");
    expect(lireJeton(j)).toBe("3f1c-contact");
    expect(lireJeton(j.slice(0, -2) + "xx")).toBeNull();
  });
});
