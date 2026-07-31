/* ============================================================
   Dublin Police Department — Scenario-Based Training Task Sheet
   Checklist definition, weights, and note-keyword mappings.

   Weights:
     3 = Critical  (safety, legal authority, use of force)
     2 = Core      (standard performance expectations)
     1 = Minor     (available if needed)

   Keywords are matched (case-insensitive substring) against
   trainer notes to recommend lines to grade.
   ============================================================ */

const CHECKLIST = [
  {
    id: "cs",
    name: "Communication Skills",
    lines: [
      { id: "cs1", w: 2, text: "Officer used clear, professional verbal commands.",
        kw: ["verbal command", "commands", "unclear", "mumbl", "profession", "yell"] },
      { id: "cs2", w: 2, text: "Officer communicated effectively with dispatch and other officers.",
        kw: ["dispatch", "radio", "communicat"] },
      { id: "cs3", w: 2, text: "Maintained command presence in a proper and appropriate way.",
        kw: ["command presence", "presence", "timid", "passive", "overbearing"] },
      { id: "cs4", w: 2, text: "Provided clear expectations to involved parties, including clear and simple instructions.",
        kw: ["instruction", "expectation", "confus", "direction"] },
    ],
  },
  {
    id: "de",
    name: "De-Escalation and Crisis Response",
    lines: [
      { id: "de1", w: 2, text: "Officer slowed the situation when possible, buys time if necessary.",
        kw: ["slow", "rushed", "buy time", "hurried", "hasty"] },
      { id: "de2", w: 3, text: "Officer demonstrated proper time/distance/cover.",
        kw: ["distance", "time/distance", "too close", "closed distance", "cover"] },
      { id: "de3", w: 2, text: "Officer is able to recognize mental health or emotional distress indicators.",
        kw: ["mental health", "mental", "crisis", "distress", "emotional", "suicid"] },
      { id: "de4", w: 2, text: "Officer adjusted communication style appropriately when necessary and appropriate.",
        kw: ["tone", "adjust", "communication style", "escalated verbally"] },
      { id: "de5", w: 2, text: "Officer requested/provided specialized resources when appropriate.",
        kw: ["resource", "cit ", "crisis team", "medic", "squad", "referral"] },
    ],
  },
  {
    id: "lf",
    name: "Legal Foundation",
    lines: [
      { id: "lf1", w: 3, text: "Demonstrates correct understanding of legal authority.",
        kw: ["legal authority", "authority", "unlawful"] },
      { id: "lf2", w: 3, text: "Properly articulate the difference between RAS and PC.",
        kw: ["ras", "reasonable suspicion", "probable cause", " pc "] },
      { id: "lf3", w: 3, text: "Officer properly articulated RAS when conducting a search.",
        kw: ["ras", "reasonable suspicion", "articulat"] },
      { id: "lf4", w: 3, text: "Officer properly articulated PC when conducting a search/arrest.",
        kw: ["probable cause", " pc ", "articulat"] },
      { id: "lf5", w: 3, text: "Officer read Miranda rights when required and at the proper time.",
        kw: ["miranda", "rights"] },
      { id: "lf6", w: 2, text: "Officer understands and can articulate legal threshold to continue a stop.",
        kw: ["threshold", "prolong", "extend the stop", "continue a stop", "detained too long"] },
      { id: "lf7", w: 3, text: "Officer understands and demonstrates the difference between a search and a pat down and when to use both.",
        kw: ["pat down", "patdown", "pat-down", "frisk", "search"] },
      { id: "lf8", w: 2, text: "Officer properly articulated pink slip criteria.",
        kw: ["pink slip", "pinkslip", "involuntary", "hold criteria"] },
      { id: "lf9", w: 2, text: "Officer understands and articulates Dublin city ordinances and ORC.",
        kw: ["ordinance", "orc", "revised code", "city code"] },
      { id: "lf10", w: 3, text: "Understands and articulates exceptions to search warrant requirements.",
        kw: ["warrant", "consent", "exigen", "plain view", "search incident"] },
      { id: "lf11", w: 3, text: "Understands and executes the difference between detention (RAS) and arrest (PC).",
        kw: ["detention", "detain", "arrest", "custody"] },
    ],
  },
  {
    id: "os",
    name: "Officer Safety",
    lines: [
      { id: "os1", w: 3, text: "Maintained situational awareness.",
        kw: ["awareness", "tunnel vision", "distracted", "didn't see", "did not see", "lost track"] },
      { id: "os2", w: 3, text: "Officer used proper positioning and reactionary gap.",
        kw: ["position", "reactionary gap", "reactionary", "stance", "angle"] },
      { id: "os3", w: 2, text: "Used cover and concealment when appropriate/necessary.",
        kw: ["cover", "concealment", "exposed", "open"] },
      { id: "os4", w: 2, text: "Requested backup when necessary and appropriate, and at the proper time.",
        kw: ["backup", "back-up", "back up", "alone", "solo"] },
      { id: "os5", w: 3, text: "Conducted proper frisk/search techniques.",
        kw: ["frisk", "search", "missed the knife", "missed the weapon", "missed weapon"] },
      { id: "os6", w: 3, text: "Officer maintained control of weapon.",
        kw: ["weapon", "holster", "retention", "firearm", "gun", "taser", "muzzle"] },
    ],
  },
  {
    id: "ap",
    name: "Arrest Procedures",
    lines: [
      { id: "ap1", w: 2, text: "Advised suspect of intent to use legal authority.",
        kw: ["advised", "intent", "under arrest", "told the suspect"] },
      { id: "ap2", w: 3, text: "Maintained control of suspect prior to retrieving/applying handcuffs.",
        kw: ["control of suspect", "control of the suspect", "handcuff", "cuff", "broke free", "resist"] },
      { id: "ap3", w: 2, text: "Used Faulkner handcuffing technique.",
        kw: ["faulkner", "handcuff", "cuffing technique"] },
      { id: "ap4", w: 2, text: "Officer gapped/double locked handcuffs.",
        kw: ["double lock", "double-lock", "gapped", "gapping", "cuffs too tight", "tight cuffs"] },
    ],
  },
  {
    id: "uf",
    name: "Use of Force",
    lines: [
      { id: "uf1", w: 3, text: "Officers choice of use of force was consistent with situation/subject behavior.",
        kw: ["use of force", "force option", "went hands on", "hands-on", "excessive"] },
      { id: "uf2", w: 3, text: "Use of force decision is consistent with departmental use of force policy.",
        kw: ["force policy", "use of force", "policy"] },
      { id: "uf3", w: 3, text: "Officer attempted de-escalation if possible before resorting to use of force.",
        kw: ["de-escalat", "deescalat", "escalated too fast", "jumped to force", "went straight to"] },
      { id: "uf4", w: 3, text: "Officer ceased force when the threat was controlled.",
        kw: ["ceased force", "kept striking", "continued force", "after compliance", "stopped resisting"] },
      { id: "uf5", w: 2, text: "Officer demonstrates proper transition between use of force options.",
        kw: ["transition", "taser", "oc spray", "baton", "less lethal", "less-lethal"] },
      { id: "uf6", w: 2, text: "Notified Dispatch of Use of Force occurrence (medics, supervisor, etc.).",
        kw: ["notified dispatch", "notify dispatch", "supervisor", "medic"] },
      { id: "uf7", w: 3, text: "Officer rendered aid when safe to do so.",
        kw: ["rendered aid", "render aid", "medical", "injur", "first aid"] },
    ],
  },
  {
    id: "sm",
    name: "Scene Management",
    lines: [
      { id: "sm1", w: 2, text: "Officer established control of the scene.",
        kw: ["control of the scene", "scene control", "chaotic", "chaos", "lost control"] },
      { id: "sm2", w: 2, text: "Officer separated involved parties when necessary.",
        kw: ["separat", "parties together", "kept arguing"] },
      { id: "sm3", w: 2, text: "Properly identified witnesses and involved individuals.",
        kw: ["witness", "identif", "id'd", "ids"] },
      { id: "sm4", w: 2, text: "Officer properly preserved evidence.",
        kw: ["preserv", "evidence", "contaminat", "stepped on"] },
      { id: "sm5", w: 2, text: "Officer properly collected and documented evidence.",
        kw: ["collect", "evidence", "bagged", "photograph"] },
      { id: "sm6", w: 3, text: "Officer made appropriate legal decisions (arrest, citation, release, etc.) for the right person (properly identified suspect).",
        kw: ["citation", "cited", "release", "wrong person", "wrong subject", "arrest decision", "charged"] },
    ],
  },
  {
    id: "rd",
    name: "Reporting/Documentation",
    lines: [
      { id: "rd1", w: 2, text: "Officer was able to document the details/facts of the scene clearly and in chronological order.",
        kw: ["report", "document", "chronolog", "narrative"] },
      { id: "rd2", w: 2, text: "Officer properly articulated legal justification for their decisions in said documentation.",
        kw: ["justification", "justify", "report", "articulat"] },
      { id: "rd3", w: 2, text: "Report/debrief included all required elements (time, location, involved parties, evidence, etc.).",
        kw: ["debrief", "report", "missing element", "left out"] },
      { id: "rd4", w: 2, text: "Officer accurately documented force used.",
        kw: ["documented force", "document force", "force report", "response to resistance"] },
    ],
  },
  {
    id: "pe",
    name: "Professionalism/Ethics",
    lines: [
      { id: "pe1", w: 3, text: "Officer demonstrated impartial and bias-free conduct.",
        kw: ["bias", "impartial", "discrimin", "profiling"] },
      { id: "pe2", w: 2, text: "Officer followed departmental policy during scenario (no cussing, maintaining respect, etc.).",
        kw: ["cuss", "profan", "swore", "swear", "disrespect", "unprofessional", "attitude", "rude"] },
    ],
  },
];

/* Default scenario library — placeholder titles.
   Edit, delete, or add your department's actual scenarios in
   Settings → Scenario Library (changes are saved on the device). */
const DEFAULT_SCENARIOS = [
  "Traffic Stop — Compliant Driver",
  "Traffic Stop — Armed Driver",
  "Domestic Dispute — Verbal",
  "Domestic Dispute — Physical",
  "Mental Health Crisis — Suicidal Subject",
  "Disorderly Subject — Business Complaint",
  "Suspicious Person — Terry Stop",
  "Shoplifting / Theft in Progress",
  "Felony Warrant Arrest",
  "Trespassing Complaint",
  "Welfare Check",
  "Active Resistance / Use of Force",
];

const WEIGHT_LABELS = { 3: "Critical", 2: "Core", 1: "Minor" };
