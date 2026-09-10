"""Évaluation du RAG Dedhicated sur le règlement IA (AI Act).

Usage (conteneur up, index du règlement IA ingéré) :
  python eval_rag.py check     # vérifie que chaque preuve existe dans les chunks indexés
  python eval_rag.py stats     # statistiques d'ingestion et du graphe -> out/ingestion_stats.json
  python eval_rag.py run       # interroge l'API + juge LLM -> out/results.jsonl (reprend si interrompu)
  python eval_rag.py report    # agrège -> out/summary.json
  node build_report.js         # rapport Word (après npm install)

Variables : EVAL_POC_DIR (dossier du déploiement : .env + rag_data, défaut ../../dedhicated-app),
EVAL_API_URL (défaut http://localhost:85), EVAL_OUT_DIR (défaut ./out), EVAL_JUDGE_MODEL
(défaut gpt-oss-120b), EVAL_CONFIGS (sous-ensemble de configurations, séparées par des virgules).

ponytail: stdlib + openai, pas de RAGAS ; les métriques déterministes (hit@k, MRR, faits, pièges)
servent de garde-fou au juge LLM.
"""
import base64, collections, json, os, re, statistics, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
POC = Path(os.environ.get("EVAL_POC_DIR", HERE.parent.parent / "dedhicated-app"))
OUT = Path(os.environ.get("EVAL_OUT_DIR", HERE / "out"))
OUT.mkdir(parents=True, exist_ok=True)
ENV = dict(l.strip().split("=", 1) for l in open(POC / ".env") if "=" in l and not l.startswith("#"))
API = os.environ.get("EVAL_API_URL", "http://localhost:85")
AUTH = "Basic " + base64.b64encode(f"{ENV['AUTH_USER']}:{ENV['AUTH_PASSWORD']}".encode()).decode()
# Juge d'une autre famille que le générateur (mistral) : limite l'auto-complaisance.
JUDGE_MODEL = os.environ.get("EVAL_JUDGE_MODEL", "gpt-oss-120b")
N = r"[\s  .]?"  # séparateur de milliers
REFUSAL = r"(ne dispose pas|pas d.informations?|ne contient pas|ne précise pas|ne mentionne pas|ne fournit pas|aucune information|ne figure pas|n.est pas (mentionné|précisé|traité|abordé))"
TRAPS = {"piège-hallucination", "hors périmètre", "fausse prémisse"}

# id, catégorie, question, réponse de référence, preuves (regex sur chunks, OR), faits attendus (regex sur réponse), interdits
DATASET = [
 ("Q01", "définition", "Comment le règlement définit-il un « système d'IA » ?",
  "Art. 3(1) : système automatisé conçu pour fonctionner à différents niveaux d'autonomie, pouvant faire preuve d'adaptation après déploiement, qui déduit à partir des entrées la manière de générer des sorties (prédictions, contenu, recommandations, décisions) pouvant influencer les environnements physiques ou virtuels.",
  [r"système automatisé qui est conçu pour fonctionner à différents niveaux d.autonomie"],
  [r"automatis", r"autonomie", r"adapta", r"(dédui|inf[eé]r)", r"(prédiction|recommandation|décision)"], []),
 ("Q02", "définition", "Que signifie « risque » au sens du règlement ?",
  "Art. 3(2) : la combinaison de la probabilité d'un préjudice et de la sévérité de celui-ci.",
  [r"la combinaison de la probabilité d.un préjudice et de la sévérité"],
  [r"probabilit", r"(sévérité|gravité)"], []),
 ("Q03", "obligation", "Quelle obligation l'article 4 impose-t-il aux fournisseurs et déployeurs en matière de maîtrise de l'IA ?",
  "Art. 4 : prendre des mesures pour garantir, dans toute la mesure du possible, un niveau suffisant de maîtrise de l'IA pour leur personnel et les personnes s'occupant des systèmes pour leur compte, en tenant compte de leurs connaissances techniques, expérience, éducation, formation et du contexte d'utilisation.",
  [r"un niveau suffisant de maîtrise de l.IA pour leur personnel"],
  [r"niveau suffisant", r"personnel", r"(connaissances techniques|expérience|formation)"], []),
 ("Q04", "interdiction", "L'utilisation d'un système de reconnaissance des émotions des salariés sur le lieu de travail est-elle autorisée ?",
  "Non : art. 5(1)(f) interdit les systèmes d'IA pour inférer les émotions sur le lieu de travail et dans les établissements d'enseignement, sauf raisons médicales ou de sécurité.",
  [r"inférer les émotions d.une personne physique sur le lieu de travail"],
  [r"interdi", r"(médical|sécurité)"], []),
 ("Q05", "interdiction", "Peut-on constituer une base de données de reconnaissance faciale en collectant des images sur internet ?",
  "Non : art. 5(1)(e) interdit les systèmes créant ou développant des bases de reconnaissance faciale par moissonnage non ciblé d'images faciales provenant d'internet ou de la vidéosurveillance.",
  [r"moissonnage non ciblé d.images faciales"],
  [r"interdi", r"(moissonnage|non cibl)", r"(vidéosurveillance|internet)"], []),
 ("Q06", "liste", "Quelles sont les pratiques d'IA interdites par l'article 5 ?",
  "Art. 5(1) : (a) techniques subliminales/manipulatrices ; (b) exploitation des vulnérabilités ; (c) notation sociale ; (d) prédiction d'infraction fondée uniquement sur le profilage ; (e) bases de reconnaissance faciale par moissonnage non ciblé ; (f) inférence des émotions au travail/école ; (g) catégorisation biométrique (race, opinions…) ; (h) identification biométrique à distance en temps réel à des fins répressives dans l'espace public (sauf exceptions).",
  [r"Pratiques interdites en matière d.IA 1\. Les pratiques"],
  [r"sublimina", r"vulnérabilit", r"(notation sociale|note sociale|comportement social)", r"(infraction pénale|profilage)",
   r"(reconnaissance faciale|moissonnage)", r"émotion", r"catégorisation biométrique", r"(temps réel|identification biométrique à distance)"], []),
 ("Q07", "interdiction", "Un système d'IA qui prédit le risque qu'une personne commette une infraction uniquement sur la base de son profilage est-il autorisé ?",
  "Non : art. 5(1)(d) l'interdit, sauf pour étayer une évaluation humaine déjà fondée sur des faits objectifs et vérifiables liés à une activité criminelle.",
  [r"uniquement sur la base du profilage d.une personne physique"],
  [r"interdi", r"(faits objectifs|vérifiable|évaluation humaine)"], []),
 ("Q08", "classification", "Dans quels cas un système d'IA listé à l'annexe III n'est-il pas considéré comme à haut risque ?",
  "Art. 6(3) : absence de risque important, lorsque le système (a) accomplit une tâche procédurale étroite, (b) améliore le résultat d'une activité humaine préalable, (c) détecte des constantes/écarts sans remplacer l'évaluation humaine, ou (d) exécute une tâche préparatoire. Toujours à haut risque s'il effectue un profilage ; le fournisseur documente son évaluation et enregistre le système (art. 49(2)).",
  [r"destiné à accomplir un[e]? tâche procédurale étroite"],
  [r"procédurale étroite", r"améliorer le résultat", r"(constantes|écarts)", r"préparatoire", r"profilage"], []),
 ("Q09", "classification", "Les systèmes d'IA utilisés pour décider de l'admission d'étudiants dans un établissement d'enseignement sont-ils à haut risque ?",
  "Oui : annexe III, point 3 (éducation et formation professionnelle), a) systèmes déterminant l'accès, l'admission ou l'affectation à des établissements d'enseignement.",
  [r"déterminer l.accès, l.admission ou l.affectation de personnes physiques à des établissements d.enseignement"],
  [r"haut risque", r"annexe III"], []),
 ("Q10", "sanctions", "Quels sont les différents plafonds d'amendes prévus par l'article 99 ?",
  "Art. 99 : pratiques interdites jusqu'à 35 M EUR ou 7 % du CA mondial ; autres obligations (fournisseurs, mandataires, importateurs, distributeurs, déployeurs, organismes notifiés, transparence art. 50) jusqu'à 15 M EUR ou 3 % ; informations inexactes jusqu'à 7,5 M EUR ou 1 % ; le montant le plus élevé est retenu (le plus faible pour les PME).",
  [r"35 000 000 EUR", r"15 000 000 EUR ou, si l.auteur", r"7 500 000 EUR"],
  [rf"35({N}000{N}000| millions?| M)", r"7\s?%", rf"15({N}000{N}000| millions?| M)", r"3\s?%", rf"7({N}500{N}000|[,.]5 millions?|[,.]5 M)", r"1\s?%"], []),
 ("Q11", "sanctions", "Quelles amendes peuvent être infligées aux institutions, organes et organismes de l'Union ?",
  "Art. 100 : le Contrôleur européen de la protection des données peut infliger jusqu'à 1 500 000 EUR pour les pratiques interdites et jusqu'à 750 000 EUR pour les autres non-conformités.",
  [r"1 500 000 EUR"],
  [rf"1({N}500{N}000|[,.]5 million)", rf"750{N}000", r"(Contrôleur européen de la protection des données|CEPD)"], []),
 ("Q12", "numérique", "À partir de quel seuil de calcul d'entraînement un modèle d'IA à usage général est-il présumé présenter un risque systémique ?",
  "Art. 51(2) : quantité cumulée de calcul d'entraînement supérieure à 10^25 opérations en virgule flottante (FLOP).",
  [r"opérations en virgule flottante est supérieure à 10"],
  [r"10\s*(\^|<sup>|puissance|e)?\s*25|10²⁵", r"(virgule flottante|FLOP)"], []),
 ("Q13", "calendrier", "Quand le règlement devient-il applicable, et quelles dispositions s'appliquent plus tôt ou plus tard ?",
  "Art. 113 : entrée en vigueur le 20e jour après publication au JO ; application générale 24 mois après ; chapitres I et II (dont interdictions) après 6 mois ; section 4 du ch. III, ch. V (IA à usage général), VII, XII et art. 78 après 12 mois (sauf art. 101) ; art. 6(1) après 36 mois. Le document ne contient pas de dates calendaires (placeholders).",
  [r"Entrée en vigueur et application Le présent règlement entre en vigueur"],
  [r"vingtième jour|20e jour", r"24 mois|vingt-quatre mois|deux ans", r"six mois|6 mois", r"12 mois|douze mois", r"36 mois|trente-six mois"], []),
 ("Q14", "piège-hallucination", "Quelle est la date exacte à laquelle les interdictions de l'article 5 entrent en application ?",
  "Le document (position du PE) ne donne pas de date calendaire : les chapitres I et II s'appliquent « six mois à compter de la date d'entrée en vigueur » (art. 113, a). Une date précise (ex. 2 février 2025) n'est pas dans le document.",
  [r"six mois à compter de la date d.entrée en vigueur du présent règlement\];"],
  [r"six mois|6 mois"], [r"2 février 2025|février 2025"]),
 ("Q15", "obligation", "Quelles obligations de transparence s'appliquent aux chatbots et aux contenus générés par IA ?",
  "Art. 50 : informer les personnes qu'elles interagissent avec une IA ; marquer les contenus de synthèse dans un format lisible par machine ; les déployeurs d'hypertrucages (deepfakes) doivent déclarer que le contenu a été généré/manipulé ; information sur la reconnaissance des émotions/catégorisation biométrique.",
  [r"soient informées qu.elles interagissent avec un système d.IA"],
  [r"inform", r"interagi", r"(lisible par machine|marqu)", r"(hypertrucage|deepfake|trucage)"], []),
 ("Q16", "obligation", "Qui doit réaliser une analyse d'impact sur les droits fondamentaux avant de déployer un système d'IA à haut risque ?",
  "Art. 27 : les déployeurs qui sont des organismes de droit public ou des entités privées fournissant des services publics, ainsi que les déployeurs des systèmes de l'annexe III point 5 b) et c) (solvabilité/score de crédit, assurance vie et santé) ; hors infrastructures critiques (annexe III point 2).",
  [r"Avant le déploiement d.un système d.IA à haut risque visé à l.article 6, paragraphe 2"],
  [r"droit public", r"services publics", r"(point 5|solvabilit|crédit|assurance)"], []),
 ("Q17", "obligation", "Quelles sont les obligations des déployeurs de systèmes d'IA à haut risque ?",
  "Art. 26 : utiliser conformément aux notices d'utilisation ; confier le contrôle humain à des personnes compétentes ; veiller à la pertinence des données d'entrée ; surveiller le fonctionnement et informer fournisseur/autorités des risques et incidents ; conserver les journaux (au moins 6 mois) ; informer les travailleurs et les personnes concernées, etc.",
  [r"Obligations incombant aux déployeurs de systèmes d.IA à haut risque 1\."],
  [r"notice", r"contrôle humain", r"(journaux|surveill|inform)"], []),
 ("Q18", "obligation", "Quelles obligations incombent aux fournisseurs de modèles d'IA à usage général ?",
  "Art. 53 : documentation technique (annexe XI) pour le Bureau de l'IA et les autorités ; informations/documentation pour les fournisseurs en aval (annexe XII) ; politique de respect du droit d'auteur (réservation de droits) ; résumé suffisamment détaillé du contenu d'entraînement. Exemptions partielles pour les modèles sous licence libre et ouverte (sauf risque systémique).",
  [r"Obligations incombant aux fournisseurs de modèles d.IA à usage général 1\. Les fournisseurs"],
  [r"documentation technique", r"droit d.auteur", r"(résumé|contenu utilisé pour l.entraînement|données d.entraînement)", r"(fournisseurs de systèmes d.IA|en aval|intégrer)"], []),
 ("Q19", "champ d'application", "Le règlement s'applique-t-il aux systèmes d'IA utilisés exclusivement à des fins militaires ?",
  "Non : art. 2(3), les systèmes mis sur le marché, mis en service ou utilisés exclusivement à des fins militaires, de défense ou de sécurité nationale sont exclus, quel que soit le type d'entité.",
  [r"fins militaires, de défense ou de sécurité nationale"],
  [r"(ne s.applique pas|exclu|hors du champ)", r"(défense|sécurité nationale)"], []),
 ("Q20", "champ d'application", "Une entreprise américaine sans établissement dans l'UE est-elle concernée si les sorties de son système d'IA sont utilisées dans l'Union ?",
  "Oui : art. 2(1)(c), le règlement s'applique aux fournisseurs et déployeurs établis dans un pays tiers lorsque les sorties produites par le système d'IA sont utilisées dans l'Union (et un mandataire est requis pour les fournisseurs non établis).",
  [r"lorsque les sorties produites par le système d.IA sont utilisées dans l.Union"],
  [r"(oui|s.applique|concern|soumis)", r"sorties", r"Union"], []),
 ("Q21", "numérique", "Dans quel délai un incident grave perturbant une infrastructure critique doit-il être signalé ?",
  "Art. 73(3) : en cas d'infraction généralisée ou d'incident grave au sens de l'art. 3(49)(b) (perturbation grave d'une infrastructure critique), signalement immédiat et au plus tard deux jours après en avoir eu connaissance.",
  [r"au plus tard deux jours après que le fournisseur"],
  [r"deux jours|2 jours|48 ?h", r"immédiat"], []),
 ("Q22", "gouvernance", "Les États membres doivent-ils mettre en place des bacs à sable réglementaires de l'IA ?",
  "Oui : art. 57, chaque État membre veille à ce que ses autorités compétentes mettent en place au moins un bac à sable réglementaire de l'IA au niveau national (possiblement conjointement avec d'autres États membres), opérationnel 24 mois après l'entrée en vigueur.",
  [r"au moins un bac à sable réglementaire"],
  [r"au moins un", r"national"], []),
 ("Q23", "multi-sauts", "Quelles obligations supplémentaires s'appliquent aux modèles d'IA à usage général présentant un risque systémique par rapport aux autres modèles ?",
  "Art. 55 (en plus de l'art. 53) : évaluation des modèles selon des protocoles normalisés, y compris essais contradictoires ; évaluation et atténuation des risques systémiques ; suivi, documentation et signalement des incidents graves au Bureau de l'IA ; niveau adéquat de cybersécurité.",
  [r"Obligations incombant aux fournisseurs de modèles d.IA à usage général présentant un risque systémique 1\."],
  [r"(évaluation(s)? de(s)? modèle|essais contradictoires|adversari)", r"incident(s)? grave", r"cybersécurité", r"(atténu|risques systémiques)"], []),
 ("Q24", "multi-sauts", "Quelles exigences s'appliquent aux systèmes d'IA à haut risque (chapitre III, section 2) ?",
  "Art. 9 à 15 : système de gestion des risques ; données et gouvernance des données ; documentation technique ; enregistrement (journaux) ; transparence et information des déployeurs ; contrôle humain ; exactitude, robustesse et cybersécurité.",
  [r"Système de gestion des risques 1\.", r"Données et gouvernance des données 1\."],
  [r"gestion des risques", r"gouvernance des données", r"documentation technique", r"(enregistrement|journaux)", r"transparence", r"contrôle humain", r"(exactitude|robustesse|cybersécurité)"], []),
 ("Q25", "multilingue", "What are the maximum fines for non-compliance with the prohibited AI practices?",
  "Art. 99(3): up to EUR 35,000,000 or, for undertakings, up to 7% of total worldwide annual turnover for the preceding financial year, whichever is higher.",
  [r"35 000 000 EUR"],
  [r"35", r"7\s?%"], []),
 ("Q26", "formulation vague", "C'est quoi le problème avec la notation sociale ?",
  "La notation sociale (art. 5(1)(c)) est interdite lorsqu'elle entraîne un traitement préjudiciable ou défavorable dans des contextes sans lien avec la collecte des données, ou injustifié/disproportionné ; considérant : risques de discrimination, d'exclusion et d'atteinte à la dignité.",
  [r"la note sociale conduisant à l.une ou l.autre des situations suivantes", r"notation sociale des personnes physiques"],
  [r"interdi", r"(préjudiciable|défavorable|discrimin)"], []),
 ("Q27", "hors périmètre", "Quelle est la capitale de l'Australie ?",
  "Hors périmètre : le document ne traite pas de cette question ; le système doit l'indiquer plutôt que répondre de mémoire.",
  [], [REFUSAL], [r"Canberra"]),
 ("Q28", "hors périmètre", "Quel est le montant maximal des amendes prévues par le RGPD ?",
  "Hors périmètre : le règlement IA renvoie au RGPD mais ne fixe pas ses amendes (20 M EUR / 4 % dans le RGPD) ; le système doit signaler que l'information n'est pas dans le document.",
  [], [REFUSAL], [rf"20({N}000{N}000| millions?)", r"4\s?%"]),
 ("Q29", "fausse prémisse", "Pourquoi le règlement sur l'IA interdit-il totalement l'utilisation de systèmes d'IA dans le recrutement ?",
  "Prémisse fausse : le recrutement n'est pas interdit ; les systèmes d'IA de recrutement/sélection sont classés à haut risque (annexe III, point 4 a) et soumis à des exigences. Seule l'inférence des émotions au travail est interdite.",
  [r"recrutement ou la sélection de personnes physiques"],
  [r"haut risque", r"(pas interdit|n.est pas interdit|ne l.interdit pas|n.interdit pas|pas d.interdiction|aucune interdiction|pas totalement|pas une interdiction|n.impose pas une interdiction)"], []),
 ("Q30", "fausse prémisse", "Quel est le montant de l'amende de 50 millions d'euros prévue pour les fournisseurs de modèles d'IA à usage général ?",
  "Prémisse fausse : l'art. 101 prévoit pour les fournisseurs de modèles d'IA à usage général des amendes jusqu'à 3 % du CA mondial ou 15 000 000 EUR, le montant le plus élevé étant retenu ; aucun montant de 50 M EUR.",
  [r"Amendes applicables aux fournisseurs de modèles d.IA à usage général"],
  [rf"15({N}000{N}000| millions?| M)", r"3\s?%"], []),
 ("Q31", "définition", "Qui est considéré comme « fournisseur » au sens du règlement ?",
  "Art. 3(3) : personne physique ou morale, autorité publique, agence ou autre organisme qui développe ou fait développer un système d'IA ou un modèle d'IA à usage général et le met sur le marché ou met le système en service sous son propre nom ou sa propre marque, à titre onéreux ou gratuit.",
  [r"une autorité publique, une agence ou tout autre organisme qui développe ou fait développer un système d.IA"],
  [r"développe", r"(propre nom|propre marque)", r"(sur le marché|en service)"], []),
 ("Q32", "définition", "Qu'est-ce qu'un « déployeur » ?",
  "Art. 3(4) : personne physique ou morale, autorité publique, agence ou autre organisme utilisant sous sa propre autorité un système d'IA, sauf dans le cadre d'une activité personnelle à caractère non professionnel.",
  [r"utilisant sous sa propre autorité un système d.IA"],
  [r"propre autorité", r"(non professionnel|activité personnelle)"], []),
 ("Q33", "interdiction", "Dans quels cas l'identification biométrique à distance en temps réel est-elle autorisée pour les forces de l'ordre ?",
  "Art. 5(1)(h) : uniquement si strictement nécessaire pour (i) la recherche ciblée de victimes (enlèvement, traite, exploitation sexuelle) et de personnes disparues, (ii) la prévention d'une menace spécifique, substantielle et imminente pour la vie ou d'une attaque terroriste, (iii) la localisation ou l'identification de suspects d'infractions de l'annexe II passibles d'au moins quatre ans ; avec autorisation préalable et analyse d'impact.",
  [r"recherche ciblée de victimes.{0,3}spécifiques"],
  [r"victimes", r"(terroris|menace)", r"(quatre ans|4 ans)", r"autorisation"], []),
 ("Q34", "obligation", "Quelles mesures de contrôle humain doivent permettre les systèmes d'IA à haut risque ?",
  "Art. 14 : conception permettant un contrôle effectif par des personnes physiques (outils d'interface homme-machine) ; comprendre capacités et limites, rester conscient du biais d'automatisation, interpréter les sorties, décider de ne pas utiliser ou d'ignorer la sortie, intervenir ou interrompre le système (bouton d'arrêt) ; double vérification pour l'identification biométrique.",
  [r"biais d.automatisation"],
  [r"homme-machine", r"(interromp|arrêt)", r"automatisation"], []),
 ("Q35", "numérique", "Combien de temps les déployeurs doivent-ils conserver les journaux générés par un système d'IA à haut risque ?",
  "Art. 26(6) : pendant une période adaptée à la destination du système, d'au moins six mois, sauf disposition contraire du droit de l'Union ou national (notamment protection des données).",
  [r"au moins six mois"],
  [r"six mois|6 mois"], []),
 ("Q36", "obligation", "Quand un fournisseur doit-il enregistrer un système d'IA à haut risque dans la base de données de l'UE ?",
  "Art. 49(1) : avant la mise sur le marché ou la mise en service d'un système d'IA à haut risque visé à l'annexe III (sauf point 2), le fournisseur ou son mandataire s'enregistre et enregistre le système dans la base de données de l'UE (art. 71).",
  [r"Enregistrement 1\. Avant de mettre sur le marché ou de mettre en service un système d.IA à haut risque énuméré à l.annexe III"],
  [r"avant", r"base de données"], []),
 ("Q37", "obligation", "Comment le marquage CE doit-il être apposé sur un système d'IA à haut risque ?",
  "Art. 48 : de manière visible, lisible et indélébile ; sous forme numérique pour les systèmes fournis numériquement ; suivi le cas échéant du numéro d'identification de l'organisme notifié.",
  [r"marquage CE.{0,30}apposé de (façon|manière) visible, lisible et indélébile"],
  [r"visible", r"(lisible|indélébile)"], []),
 ("Q38", "classification", "Quelle procédure d'évaluation de la conformité s'applique aux systèmes d'IA à haut risque de l'annexe III, points 2 à 8 ?",
  "Art. 43(2) : la procédure fondée sur le contrôle interne (annexe VI), sans intervention d'un organisme notifié ; pour la biométrie (point 1), contrôle interne si les normes harmonisées sont appliquées, sinon organisme notifié (annexe VII).",
  [r"procédure d.évaluation de la conformité fondée sur le contrôle interne"],
  [r"contrôle interne", r"(organisme notifié|annexe VI)"], []),
 ("Q39", "gouvernance", "Comment est composé le Comité européen de l'intelligence artificielle ?",
  "Art. 65 : un représentant par État membre (mandat de trois ans renouvelable une fois) ; le Contrôleur européen de la protection des données participe en tant qu'observateur ; le Bureau de l'IA assiste sans droit de vote.",
  [r"Le Comité est composé d.un représentant par État membre"],
  [r"un représentant par État membre", r"observateur"], []),
 ("Q40", "gouvernance", "Quel est le rôle du groupe scientifique d'experts indépendants ?",
  "Art. 68 : experts indépendants sélectionnés par la Commission qui conseillent et assistent le Bureau de l'IA, notamment en alertant sur les risques systémiques des modèles d'IA à usage général (alertes qualifiées) et en contribuant aux outils et méthodologies d'évaluation.",
  [r"groupe scientifique d.experts indépendants"],
  [r"experts indépendants", r"alerte", r"risques? systémiques?"], []),
 ("Q41", "gouvernance", "Quelles autorités nationales chaque État membre doit-il désigner ?",
  "Art. 70 : au moins une autorité notifiante et au moins une autorité de surveillance du marché, en tant qu'autorités nationales compétentes, dont un point de contact unique.",
  [r"au moins une autorité notifiante et au moins une autorité de surveillance du marché"],
  [r"autorité notifiante", r"surveillance du marché"], []),
 ("Q42", "droits", "Une personne qui estime qu'un système d'IA enfreint le règlement peut-elle déposer une réclamation ?",
  "Oui : art. 85, toute personne physique ou morale ayant des motifs de considérer qu'il y a eu violation peut introduire une réclamation auprès de l'autorité de surveillance du marché concernée.",
  [r"réclamation auprès de l.autorité de surveillance du marché"],
  [r"réclamation", r"surveillance du marché"], []),
 ("Q43", "droits", "Existe-t-il un droit à l'explication des décisions prises à l'aide d'un système d'IA à haut risque ?",
  "Oui : art. 86, toute personne faisant l'objet d'une décision fondée sur la sortie d'un système à haut risque de l'annexe III (sauf point 2) produisant des effets juridiques ou l'affectant de manière significative a le droit d'obtenir du déployeur des explications claires et pertinentes sur le rôle du système et les principaux éléments de la décision.",
  [r"Droit à l.explication des décisions individuelles"],
  [r"explication", r"déployeur", r"(effets juridiques|significativ)"], []),
 ("Q44", "numérique", "Quelle est la durée maximale des essais de systèmes d'IA à haut risque en conditions réelles hors bac à sable ?",
  "Art. 60(4)(f) : pas plus longtemps que nécessaire et au maximum six mois, prolongeable une fois de six mois sous réserve de notification préalable à l'autorité de surveillance du marché.",
  [r"conditions réelles ne dur(e|ent) pas plus longtemps que nécessaire"],
  [r"six mois|6 mois", r"(prolong|renouvel)"], []),
 ("Q45", "obligation", "Les fournisseurs de modèles d'IA à usage général publiés sous licence libre et ouverte sont-ils exemptés d'obligations ?",
  "Art. 53(2) : exemptés de la documentation technique et des informations aux fournisseurs en aval (art. 53(1) a et b) si le modèle est sous licence libre et ouverte avec paramètres publiés ; pas d'exemption pour la politique droit d'auteur et le résumé des données d'entraînement, ni pour les modèles présentant un risque systémique.",
  [r"licence libre et ouverte permettant de consulter, d.utiliser, de modifier et de distribuer le modèle"],
  [r"(libre et ouvert|open source)", r"risque systémique", r"(droit d.auteur|résumé)"], []),
 ("Q46", "obligation", "Un fournisseur de modèle d'IA à usage général établi hors de l'UE doit-il désigner un mandataire ?",
  "Oui : art. 54, avant de mettre le modèle sur le marché de l'Union, il désigne par mandat écrit un mandataire établi dans l'Union (sauf exemption pour certains modèles libres et ouverts sans risque systémique).",
  [r"Mandataires des fournisseurs de modèles d.IA à usage général"],
  [r"mandataire", r"dans l.Union"], []),
 ("Q47", "liste", "Quels sont les domaines de systèmes d'IA à haut risque énumérés à l'annexe III ?",
  "Annexe III : 1. biométrie ; 2. infrastructures critiques ; 3. éducation et formation professionnelle ; 4. emploi et gestion de la main-d'œuvre ; 5. accès aux services privés essentiels et aux services et prestations publics essentiels ; 6. répression ; 7. migration, asile et contrôle des frontières ; 8. administration de la justice et processus démocratiques.",
  [r"ANNEXE III Systèmes d.IA à haut risque visés à l.article 6, paragraphe 2"],
  [r"biométri", r"infrastructures critiques", r"éducation", r"emploi", r"services .{0,40}essentiels", r"répressi", r"migration", r"(justice|démocratiques)"], []),
 ("Q48", "gouvernance", "Les fournisseurs de systèmes d'IA qui ne sont pas à haut risque peuvent-ils appliquer volontairement certaines exigences ?",
  "Oui : art. 95, la Commission et les États membres encouragent l'élaboration de codes de conduite pour l'application volontaire de tout ou partie des exigences du chapitre III, section 2, aux systèmes qui ne sont pas à haut risque.",
  [r"codes de conduite.{0,60}application volontaire"],
  [r"volontaire", r"codes? de conduite"], []),
 ("Q49", "sanctions", "Comment les plafonds d'amendes s'appliquent-ils aux PME et aux jeunes pousses ?",
  "Art. 99(6) : pour les PME, y compris les jeunes pousses, chaque amende s'élève au maximum aux pourcentages ou montants visés aux paragraphes 3, 4 et 5, le montant le moins élevé étant retenu.",
  [r"Dans le cas des PME, y compris les jeunes pousses"],
  [r"(moins élevé|plus faible|plus bas|le moindre)", r"PME"], []),
 ("Q50", "hors périmètre", "Quelles obligations le règlement sur les services numériques (DSA) impose-t-il aux très grandes plateformes en ligne ?",
  "Hors périmètre : le règlement IA mentionne le règlement (UE) 2022/2065 mais ne détaille pas ses obligations ; le système doit signaler que l'information n'est pas dans le document.",
  [], [REFUSAL], [r"45 millions", r"6\s?%"]),
 ("Q51", "fausse prémisse", "Pourquoi le règlement impose-t-il de signaler tous les incidents graves sous 72 heures ?",
  "Prémisse fausse : art. 73, le délai général est de 15 jours au plus tard après la connaissance de l'incident, réduit à 2 jours pour une infraction de grande ampleur ou une perturbation d'infrastructure critique et à 10 jours en cas de décès ; aucun délai de 72 heures.",
  [r"au plus tard deux jours après que le fournisseur"],
  [r"(15|quinze) jours", r"(deux|2) jours"], []),
]

CONFIGS = [  # (nom, mode, query_decomposition) -- les "_repetN" rejouent le défaut pour mesurer la variance
 ("hybrid_mix", "hybrid_mix", False),       # défaut de l'application
 ("naive", "naive", False),
 ("mix", "mix", False),
 ("hybrid", "hybrid", False),
 ("hybrid_mix_decomp", "hybrid_mix", True),  # ancien défaut
 ("hybrid_mix_repet2", "hybrid_mix", False),
 ("hybrid_mix_repet3", "hybrid_mix", False),
]


def norm(s):
    return re.sub(r"\s+", " ", (s or "").replace("’", "'").replace(" ", " ").replace(" ", " "))


def load_chunks():
    d = json.load(open(POC / "rag_data/kv_store_text_chunks.json"))
    return {k: {"content": norm(v["content"]), "page": v.get("page_start"), "order": v.get("chunk_order_index")} for k, v in d.items()}


def gold_for(evidence, chunks):
    return sorted(k for k, c in chunks.items() if any(re.search(p, c["content"], re.I) for p in evidence))


def post(path, payload, timeout=900):
    req = urllib.request.Request(API + path, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": AUTH})
    return json.load(urllib.request.urlopen(req, timeout=timeout))


JUDGE_PROMPT = """Tu es un évaluateur strict d'un assistant RAG juridique portant sur le règlement européen sur l'IA.
Question : {q}
Réponse de référence (vérité terrain rédigée à partir du document) : {ref}
Extraits récupérés par le système (contexte fourni au générateur) :
<<<
{ctx}
>>>
Réponse du système :
<<<
{ans}
>>>
Évalue et renvoie UNIQUEMENT un objet JSON :
{{"correctness": 0-5 (exactitude vs la référence),
 "completeness": 0-5 (couverture des éléments de la référence),
 "faithfulness": 0-5 (chaque affirmation est-elle étayée par les extraits ? 5 = tout est étayé),
 "hallucination": true/false (au moins une affirmation factuelle fausse ou non étayée par les extraits),
 "unsupported_claims": [max 3 courtes citations des affirmations fausses ou non étayées],
 "scope_or_premise_handled": true/false/null (si la question est hors périmètre ou a une fausse prémisse : le système l'a-t-il correctement signalé ? sinon null),
 "comment": "max 30 mots"}}"""


def context_of(answer):
    """Contexte réellement envoyé au LLM (entités + relations + chunks) = section Context du system_prompt."""
    sp = answer.get("system_prompt") or ""
    i = sp.find("---Context---")
    if i >= 0:
        return sp[i:i + 400000]  # ≈ 100k tokens max : tient dans la fenêtre du juge
    return "".join(f"[p.{c.get('page_start')}] {norm(c.get('content'))}\n" for c in answer.get("chunks", []) or [])[:400000]


def judge(client, q, ref, ctx, ans):
    for attempt in range(3):
        try:
            r = client.chat.completions.create(model=JUDGE_MODEL, temperature=0, messages=[
                {"role": "user", "content": JUDGE_PROMPT.format(q=q, ref=ref, ctx=ctx or "(aucun)", ans=ans or "(vide)")}])
            return json.loads(re.search(r"\{.*\}", r.choices[0].message.content, re.S).group(0))
        except Exception as e:  # noqa: BLE001
            err = str(e)
            time.sleep(3)
    return {"error": err}


def run_one(item, cfg, chunks, client):
    qid, cat, q, ref, evidence, facts, forbidden = item
    name, mode, decomp = cfg
    t = time.time()
    try:
        r = post("/query", {"query": q, "mode": mode, "query_decomposition": decomp})
    except Exception as e:  # noqa: BLE001
        r = {"success": False, "error": str(e)}
    latency = time.time() - t
    a = r.get("answer") or {}
    ans = norm(a.get("content", ""))
    got = a.get("chunks", []) or []
    gold = set(gold_for(evidence, chunks)) if evidence else set()
    ranks = [i + 1 for i, c in enumerate(got) if c.get("chunk_id") in gold]
    gold_pages = {chunks[g]["page"] for g in gold if chunks[g]["page"] is not None}
    cited = {int(p) for p in re.findall(r"pages?\s*(\d+)", ans)} | {int(p) for grp in re.findall(r"\[\d+,\s*pages?\s*([\d,\s]+)\]", ans) for p in re.findall(r"\d+", grp)}
    rec = {
        "qid": qid, "category": cat, "config": name, "mode": mode, "decomposition": decomp,
        "success": bool(r.get("success")), "error": r.get("error"), "latency_s": round(latency, 2),
        "answer": ans, "answer_chars": len(ans), "n_chunks": len(got),
        "gold_n": len(gold), "hit": bool(ranks) if gold else None, "first_rank": ranks[0] if ranks else None,
        "rr": (1 / ranks[0] if ranks else 0.0) if gold else None,
        "hit_at_5": (bool(ranks) and ranks[0] <= 5) if gold else None,
        "context_precision": (len(ranks) / len(got) if got else 0.0) if gold else None,
        "fact_recall": (sum(bool(re.search(p, ans, re.I)) for p in facts) / len(facts)) if facts else None,
        "facts_missing": [p for p in facts if not re.search(p, ans, re.I)],
        "forbidden_hit": [p for p in forbidden if re.search(p, ans, re.I)],
        "has_citation": bool(re.search(r"\[\d", ans)),
        "cited_pages": sorted(cited),
        "citation_page_ok": (any(abs(p - g) <= 2 for p in cited for g in gold_pages) if cited else False) if gold_pages else None,
        "entities_used": len(a.get("metadata", {}).get("entities", []) or []) if isinstance(a.get("metadata"), dict) else None,
    }
    ctx = context_of(a)
    sp = a.get("system_prompt") or ""
    rec["context_chars"] = len(sp)
    rec["decomposed"] = "Context for Sub-query" in sp  # en-tête ajouté par merge_query_results
    # preuve dans le contexte réellement envoyé au LLM : prompt complet, chunks encodés en JSON
    full_ctx = norm(sp.replace("\\n", " ").replace('\\"', '"'))
    rec["ctx_hit"] = any(re.search(p, full_ctx, re.I) for p in evidence) if (evidence and sp) else None
    if name == "hybrid_mix":  # gardés pour rejouer la génération avec un autre LLM (commande altgen)
        rec["system_prompt"], rec["user_prompt"] = sp, a.get("user_prompt") or ""
    rec["judge"] = judge(client, q, ref, ctx, ans) if rec["success"] else {"error": "no answer"}
    print(f"{name:24} {qid} ok={rec['success']} {rec['latency_s']:6.1f}s hit={rec['hit']} facts={rec['fact_recall']} "
          f"judge={rec['judge'].get('correctness')}/{rec['judge'].get('faithfulness')}", flush=True)
    return rec


def cmd_check():
    chunks = load_chunks()
    bad = 0
    for qid, cat, q, ref, ev, facts, forb in DATASET:
        g = gold_for(ev, chunks) if ev else []
        pages = sorted({chunks[x]["page"] for x in g})
        flag = "" if (g or not ev) else "  <-- PREUVE INTROUVABLE"
        bad += bool(flag)
        print(f"{qid} {cat:20} gold={len(g)} pages={pages}{flag}")
    print("problèmes:", bad)


def cmd_run():
    from openai import OpenAI
    client = OpenAI(api_key=ENV["EKR_LLM_API_KEY"], base_url=ENV["EKR_LLM_BASE_URL"], timeout=300)
    chunks = load_chunks()
    path = OUT / "results.jsonl"
    done = set()
    if path.exists():
        done = {(r["config"], r["qid"]) for r in map(json.loads, path.read_text().splitlines()) if r["success"]}
    only = [c for c in os.environ.get("EVAL_CONFIGS", "").split(",") if c]
    wanted = [c for c in CONFIGS if not only or c[0] in only]
    # les répétitions passent après la série principale, une par une
    for phase in [[c for c in wanted if "_repet" not in c[0]]] + [[c] for c in wanted if "_repet" in c[0]]:
        jobs = [(it, cfg) for cfg in phase for it in DATASET if (cfg[0], it[0]) not in done]
        with ThreadPoolExecutor(4) as ex, open(path, "a") as f:
            for rec in ex.map(lambda j: run_one(j[0], j[1], chunks, client), jobs):
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                f.flush()


def repeatability(rows, default):
    """Passages répétés du défaut : réponses identiques, même verdict (exactitude >= 4), écart moyen."""
    base = {r["qid"]: r for r in default}
    cj = lambda r: r["judge"].get("correctness") or 0  # noqa: E731
    out = {}
    for c in dict.fromkeys(r["config"] for r in rows):
        if "_repet" not in c:
            continue
        other = {r["qid"]: r for r in rows if r["config"] == c}
        common = [q for q in base if q in other]
        out[c] = {"n": len(common),
                  "identical_answers": sum(base[q]["answer"] == other[q]["answer"] for q in common),
                  "same_verdict": sum((cj(base[q]) >= 4) == (cj(other[q]) >= 4) for q in common),
                  "mean_abs_diff": mean([abs(cj(base[q]) - cj(other[q])) for q in common])}
    return out


def cmd_stats():
    """Statistiques d'ingestion, de chunks et du graphe de connaissances."""
    import xml.etree.ElementTree as ET
    d = POC / "rag_data"
    out = {}
    doc = next(iter(json.load(open(d / "kv_store_full_docs.json")).values()))
    pages = doc.get("pages")
    out["pages"] = len(pages) if isinstance(pages, list) else pages
    out["doc_chars"], out["doc_words"] = len(doc["content"]), len(doc["content"].split())
    st = next(iter(json.load(open(d / "kv_store_doc_status.json")).values()))
    m = st.get("metadata") or {}
    out["ingest_seconds"] = (m.get("processing_end_time") or 0) - (m.get("processing_start_time") or 0)
    out["file"] = os.path.basename(st["file_path"])
    out["created_at"] = st.get("created_at")
    out["pdf_bytes"] = os.path.getsize(POC / "data" / out["file"])
    ch = json.load(open(d / "kv_store_text_chunks.json"))
    toks = [c["tokens"] for c in ch.values()]
    out["chunks"] = len(ch)
    out["chunk_tokens"] = {"total": sum(toks), "mean": round(statistics.mean(toks)), "median": statistics.median(toks),
                           "min": min(toks), "max": max(toks)}
    ns = {"g": "http://graphml.graphdrawing.org/xmlns"}
    root = ET.parse(d / "graph_chunk_entity_relation.graphml").getroot()
    keys = {k.get("id"): k.get("attr.name") for k in root.findall("g:key", ns)}
    nodes, edges = root.findall(".//g:node", ns), root.findall(".//g:edge", ns)
    out["graph_nodes"], out["graph_edges"] = len(nodes), len(edges)
    types, deg = collections.Counter(), collections.Counter()
    for n in nodes:
        for x in n.findall("g:data", ns):
            if keys.get(x.get("key")) == "entity_type":
                types[(x.text or "").lower()] += 1
    for e in edges:
        deg[e.get("source")] += 1
        deg[e.get("target")] += 1
    out["entity_types"] = types.most_common(12)
    out["isolated_nodes"] = sum(1 for n in nodes if deg[n.get("id")] == 0)
    out["degree"] = {"mean": round(statistics.mean(deg[n.get("id")] for n in nodes), 2), "max": max(deg.values())}
    out["top_entities"] = deg.most_common(12)
    for f in ("vdb_chunks.json", "vdb_entities.json", "vdb_relationships.json"):
        j = json.load(open(d / f))
        out[f] = len(j.get("data", j))
    cache = json.load(open(d / "kv_store_llm_response_cache.json"))
    out["llm_cache_entries"] = len(cache)
    out["llm_cache_by_mode"] = collections.Counter(
        (v.get("cache_type") if isinstance(v, dict) else None) or k.split(":")[0] for k, v in cache.items()).most_common()
    sizes = {f.name: f.stat().st_size for f in d.iterdir() if f.is_file()}
    out["storage_total_mb"] = round(sum(sizes.values()) / 1e6, 1)
    setup = HERE.parent.parent / "lib" / "setup.py"
    out["lib_version"] = os.environ.get("EVAL_LIB_VERSION") or (
        re.search(r"version=[\"']([^\"']+)", setup.read_text()).group(1) if setup.exists() else "?")
    (OUT / "ingestion_stats.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(json.dumps({k: v for k, v in out.items() if k not in ("top_entities", "entity_types")}, ensure_ascii=False))


def cmd_altgen():
    """Rejoue les prompts du défaut (même contexte récupéré) avec un autre générateur, puis juge.

    EVAL_ALT_MODEL (défaut qwen-3.6-35b-instruct). Compare les LLM sans reconstruire le POC.
    ponytail: latence = génération seule, non comparable à la latence de bout en bout des autres configs.
    """
    from openai import OpenAI
    model = os.environ.get("EVAL_ALT_MODEL", "qwen-3.6-35b-instruct")
    client = OpenAI(api_key=ENV["EKR_LLM_API_KEY"], base_url=ENV["EKR_LLM_BASE_URL"], timeout=300)
    spec = {d[0]: d for d in DATASET}
    chunks = load_chunks()
    path = OUT / "results.jsonl"
    rows = [json.loads(l) for l in path.read_text().splitlines()]
    name = "hybrid_mix_" + re.sub(r"[^a-z0-9]+", "_", model.lower()).strip("_")
    done = {r["qid"] for r in rows if r["config"] == name and r["success"]}
    base = [r for r in rows if r["config"] == "hybrid_mix" and r.get("system_prompt") and r["qid"] not in done]

    def one(b):
        _, _, q, ref, evidence, _, _ = spec[b["qid"]]
        t = time.time()
        try:
            out = client.chat.completions.create(model=model, temperature=0, messages=[
                {"role": "system", "content": b["system_prompt"]},
                {"role": "user", "content": b["user_prompt"]}]).choices[0].message.content or ""
        except Exception as e:  # noqa: BLE001
            out = ""
            print("altgen error", b["qid"], e, flush=True)
        ans = norm(out)
        gold_pages = {chunks[g]["page"] for g in gold_for(evidence, chunks) if chunks[g]["page"] is not None} if evidence else set()
        cited = {int(x) for x in re.findall(r"pages?\s*(\d+)", ans)}
        rec = {k: v for k, v in b.items() if k not in ("system_prompt", "user_prompt")}
        rec.update(config=name, success=bool(ans.strip()), error=None if ans.strip() else "empty", answer=ans,
                   answer_chars=len(ans), latency_s=round(time.time() - t, 2), generation_only=True,
                   has_citation=bool(re.search(r"\[\d", ans)), cited_pages=sorted(cited),
                   citation_page_ok=(any(abs(x - g) <= 2 for x in cited for g in gold_pages) if cited else False) if gold_pages else None)
        rec["judge"] = judge(client, q, ref, context_of({"system_prompt": b["system_prompt"]}), ans) if rec["success"] else {"error": "no answer"}
        print(f"{name:24} {b['qid']} {rec['latency_s']:5.1f}s judge={rec['judge'].get('correctness')}", flush=True)
        return rec

    with ThreadPoolExecutor(4) as ex, open(path, "a") as f:
        for rec in ex.map(one, base):
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            f.flush()


def mean(xs):
    xs = [x for x in xs if x is not None]
    return round(statistics.mean(xs), 4) if xs else None


def pct(xs, p):
    xs = sorted(x for x in xs if x is not None)
    return round(xs[min(len(xs) - 1, int(round(p * (len(xs) - 1))))], 2) if xs else None


def agg(rs):
    j = [r["judge"] for r in rs if "error" not in r["judge"]]
    scoped = [x.get("scope_or_premise_handled") for x in j if x.get("scope_or_premise_handled") is not None]
    ok = [r for r in rs if r["success"]]
    return {
        "n": len(rs), "success_rate": mean([r["success"] for r in rs]),
        "latency_mean": mean([r["latency_s"] for r in ok]), "latency_p50": pct([r["latency_s"] for r in ok], .5),
        "latency_p95": pct([r["latency_s"] for r in ok], .95), "latency_max": pct([r["latency_s"] for r in ok], 1),
        "hit_rate": mean([r["hit"] for r in rs]), "hit_at_5": mean([r["hit_at_5"] for r in rs]), "mrr": mean([r["rr"] for r in rs]),
        "ctx_hit_rate": mean([r.get("ctx_hit") for r in rs]), "decomposed_rate": mean([r.get("decomposed") for r in ok]),
        "hit_rate_non_decomposed": mean([r["hit"] for r in rs if not r.get("decomposed")]),
        "context_precision": mean([r["context_precision"] for r in rs]), "fact_recall": mean([r["fact_recall"] for r in rs]),
        "citation_rate": mean([r["has_citation"] for r in ok]), "citation_page_ok": mean([r["citation_page_ok"] for r in rs]),
        "n_chunks_mean": mean([r["n_chunks"] for r in ok]), "answer_chars_mean": mean([r["answer_chars"] for r in ok]),
        "correctness": mean([x.get("correctness") for x in j]), "completeness": mean([x.get("completeness") for x in j]),
        "faithfulness": mean([x.get("faithfulness") for x in j]), "hallucination_rate": mean([x.get("hallucination") for x in j]),
        "scope_premise_handled": mean(scoped),
        "trap_pass_rate": mean([r["fact_recall"] == 1.0 and not r["forbidden_hit"] for r in rs if r["category"] in TRAPS]),
        "latency_mean_decomposed": mean([r["latency_s"] for r in ok if r.get("decomposed")]),
        "latency_mean_direct": mean([r["latency_s"] for r in ok if not r.get("decomposed")]),
        "forbidden_rate": mean([bool(r["forbidden_hit"]) for r in rs]),
    }


def cmd_report():
    rows = [json.loads(l) for l in (OUT / "results.jsonl").read_text().splitlines()]
    latest = {}
    for r in rows:  # garde la dernière tentative réussie par (config, qid)
        if r["success"] or (r["config"], r["qid"]) not in latest:
            latest[(r["config"], r["qid"])] = r
    rows = list(latest.values())
    spec = {d[0]: d for d in DATASET}
    for r in rows:  # recalcule faits / interdits avec le DATASET courant + marque les requêtes décomposées
        facts, forb = spec[r["qid"]][5], spec[r["qid"]][6]
        r["fact_recall"] = (sum(bool(re.search(x, r["answer"], re.I)) for x in facts) / len(facts)) if facts else None
        r["facts_missing"] = [x for x in facts if not re.search(x, r["answer"], re.I)]
        r["forbidden_hit"] = [x for x in forb if re.search(x, r["answer"], re.I)]
        r["decomposed"] = r.get("decomposed", r["n_chunks"] == 0 and (r.get("context_chars") or 0) > 200000)
    by = lambda key: {k: agg([r for r in rows if r[key] == k]) for k in dict.fromkeys(r[key] for r in rows)}  # noqa: E731
    default = [r for r in rows if r["config"] == "hybrid_mix"]
    ds = load_chunks()
    summary = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M"),
        "configs": by("config"),
        "repeatability": repeatability(rows, default),
        "categories_default": {c: agg([r for r in default if r["category"] == c]) for c in dict.fromkeys(r["category"] for r in default)},
        "dataset": [{"qid": d[0], "category": d[1], "question": d[2], "reference": d[3], "gold_n": len(gold_for(d[4], ds)) if d[4] else 0,
                     "gold_pages": sorted({ds[g]["page"] for g in gold_for(d[4], ds)}) if d[4] else []} for d in DATASET],
        "per_question_default": sorted(({k: v for k, v in r.items() if k not in ("system_prompt", "user_prompt")} for r in default),
                                       key=lambda r: r["qid"]),
        "per_question_all": [{k: r.get(k) for k in ("qid", "config", "success", "latency_s", "hit", "first_rank", "fact_recall", "has_citation", "decomposed", "ctx_hit")}
                             | {"correctness": r["judge"].get("correctness"), "faithfulness": r["judge"].get("faithfulness"),
                                "hallucination": r["judge"].get("hallucination")} for r in rows],
    }
    (OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1))
    for k, v in summary["configs"].items():
        print(k, v)


if __name__ == "__main__":
    {"check": cmd_check, "stats": cmd_stats, "run": cmd_run, "altgen": cmd_altgen, "report": cmd_report}[sys.argv[1]]()
