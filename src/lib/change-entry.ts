// Entrée du journal d'une fiche (change_log), sérialisable : type commun aux chargements et au composant ChangeLog (QUA-14).

/** Entrée du journal, sérialisable (voir loadChangeLogs, src/lib/data/changelog.ts). */
export type ChangeEntry = {
  id: number;
  /** Horodatage ISO. */
  at: string;
  who: string;
  action: string;
  summary: string;
  reason: string | null;
  details: { field: string; from: string | null; to: string | null }[];
};
