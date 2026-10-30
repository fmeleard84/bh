import { describe, expect, it } from "vitest";
import { communeNormalisee, domainesCandidats, estAnnuaire, liensUtiles, prouver, telephone } from "../src/server/flux/verification";
import { trancheDansBornes, nomPropre, premierPrenom } from "../src/server/texte";

describe("preuve d'identité d'un site", () => {
  it("accepte le SIREN, même espacé ou dans un SIRET", () => {
    expect(prouver("RCS Aix 812 985 331", "u", "812985331", null, []).verifie).toBe(true);
    expect(prouver("SIRET : 812.985.331.00024", "u", "812985331", null, []).verifie).toBe(true);
  });

  it("accepte commune + dirigeant, refuse l'un sans l'autre", () => {
    const t = "Nicolas Beausset, agent à Aix-en-Provence";
    expect(prouver(t, "u", "000000000", "AIX-EN-PROVENCE", ["Beausset"]).verifie).toBe(true);
    expect(prouver("Agence à Aix-en-Provence", "u", "000000000", "AIX-EN-PROVENCE", ["Beausset"]).verifie).toBe(false);
    expect(prouver("Nicolas Beausset, Lyon", "u", "000000000", "AIX-EN-PROVENCE", ["Beausset"]).verifie).toBe(false);
  });

  it("ne confond pas un nom avec un fragment de mot", () => {
    expect(prouver("Marseille, la maison Martineau", "u", "000000000", "MARSEILLE 8", ["Martin"]).verifie).toBe(false);
  });

  it("ramène un arrondissement à sa commune", () => {
    expect(communeNormalisee("MARSEILLE 8")).toBe("marseille");
    expect(communeNormalisee("AIX-EN-PROVENCE")).toBe("aix en provence");
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
