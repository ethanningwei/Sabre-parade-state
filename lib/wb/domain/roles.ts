// Vocabularies ported from Sabre Bot's config.py. Pure: no I/O.

/** Whereabouts grant roles (wb_grant.role). Kept here so client code needn't import the schema. */
export const WB_ROLES = ["GC", "PS", "PC", "2IC", "OC", "CSM", "ASA", "ADMIN"] as const;
export type WbRole = (typeof WB_ROLES)[number];

export const RANKS = [
  "REC", "PTE", "PFC", "LCP", "CPL", "CFC",
  "3SG", "2SG", "1SG", "SSG", "MSG",
  "3WO", "2WO", "1WO", "MWO",
  "2LT", "LTA", "CPT", "MAJ",
] as const;

// This order is also the order of a minimum-manning cell: "1:4:3" is one GC,
// four ST CBT, three ST SVC.
export const ROLES_GUARDROOM = ["GC", "ST CBT", "ST SVC"] as const;
export const ROLES_HQ = ["OC", "2IC", "SM", "PC", "PS", "ASA"] as const;

/** Guardroom appointments can't sit in HQ, and HQ appointments can't sit in a guardroom. */
export const rolesFor = (isHq: boolean): readonly string[] => (isHq ? ROLES_HQ : ROLES_GUARDROOM);

// v1's person.role is free text typed over years ("GUARD COMM"); this maps it
// to one vocabulary rather than retyping the roster.
export const ROLE_ALIASES: Record<string, string> = {
  "GUARD COMM": "GC", "GUARD COMMANDER": "GC", "GD COMM": "GC",
  "GUARD CMD": "GC", "GUARD COMD": "GC",
  "CBT": "ST CBT", "ST CBT": "ST CBT", "SEC TPR CBT": "ST CBT",
  "SECURITY TROOPER CBT": "ST CBT", "TROOPER CBT": "ST CBT",
  "SVC": "ST SVC", "ST SVC": "ST SVC", "SEC TPR SVC": "ST SVC",
  "SECURITY TROOPER SVC": "ST SVC", "TROOPER SVC": "ST SVC",
  "2 IC": "2IC", "PLATOON COMMANDER": "PC", "PLATOON SERGEANT": "PS",
  "SERGEANT MAJOR": "SM", "CSM": "SM", "COY SERGEANT MAJOR": "SM",
  "COMPANY SERGEANT MAJOR": "SM", "OFFICER COMMANDING": "OC",
};

/** The roster's word for an appointment, in the bot's own vocabulary. */
export function roleOf(raw: string | null | undefined): string {
  const text = (raw ?? "").toUpperCase().split(/\s+/).filter(Boolean).join(" ");
  return ROLE_ALIASES[text] ?? text;
}

/** What leave is for (Sabre Bot's LEAVE_REASONS). Anything else is typed. */
export const LEAVE_REASONS = ["Holiday", "Family", "Wedding", "Religious", "Medical"] as const;

/** Annual leave is Singapore or Johor Bahru and nothing else: further is overseas leave. */
export const AL_PLACES = ["SINGAPORE", "JOHOR BAHRU"] as const;

/**
 * What an MC or HL was for. One of these, always: the company's own reporting
 * asks how many days went to what, and free text can't be counted. "Other" is
 * allowed, and then the card says "Other": the doctor's words never go on a card.
 */
export const MC_CATEGORIES = [
  "Respiratory",
  "Gastrointestinal",
  "Musculoskeletal",
  "Dermatological",
  "Psychiatric",
  "Neurological",
  "Eye condition",
  "Ear-Nose-Throat",
  "Dental",
  "Medical Appointment",
] as const;

/** Common statuses as buttons, plus "Something else" typed as written on the paper. */
export const STATUSES = ["LIGHT DUTY"] as const;
