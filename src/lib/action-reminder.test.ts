import { describe, expect, it } from 'vitest';
import {
  REMINDER_AVANCEMENTS, REMINDER_HREF, isReminderDue, reminderKey, reminderRows, reminderSubject, reminderTitle, reminderWeek,
  renderReminderEmail, type ReminderAction,
} from './action-reminder';

// Rappel du mercredi (docs/specs/actions-qse.md § 15.2, révisé le 15/10/2026 : Terminées incluses, Reportées exclues).

const TODAY = '2026-10-14'; // mercredi, semaine 2026-W42
const SITES = new Map([['ville-a', 'Site de [Ville A] — siège et ateliers'], ['ville-b', "Site de [Ville B] — zone d'essais"]]);
const action = (id: string, status: string, dueOn: string, siteId: string | null = 'ville-a', detail = `Action ${id}`): ReminderAction => ({ id, status, dueOn, siteId, detail });

describe('reminderRows', () => {
  const actions = [
    action('A-10', 'a_faire', '2026-10-30'),
    action('A-11', 'p40', '2026-10-01', 'ville-b'), // 13 j de retard
    action('A-12', 'initiee', '2026-10-10'), // 4 j de retard
    action('A-13', 'terminee', '2026-09-01'), // date dépassée, mais Terminée : jamais en retard
    action('A-14', 'reportee', '2026-09-01'),
    action('A-15', 'verifiee', '2026-09-01'),
    action('A-16', 'abandonnee', '2026-09-01'),
    action('A-17', 'p80', '2026-10-30', null), // même date cible que A-10 : numéro décroissant
    action('A-18', 'terminee', '2026-08-15', 'ville-c'),
    action('A-19', 'en_cours', '2026-09-01'), // avancement inconnu (valeur d'avant 0005) : ignoré
  ];
  const r = reminderRows(actions, TODAY, SITES);

  it('ouvertes d’abord, retards en tête (jours de retard décroissants), puis date cible, puis numéro décroissant', () => {
    expect(r.open.map((x) => x.id)).toEqual(['A-11', 'A-12', 'A-17', 'A-10']);
    expect(r.open.map((x) => x.lateDays)).toEqual([13, 4, 0, 0]);
  });
  it('Terminées dans un second groupe, sans retard ; Reportées, Vérifiées, Abandonnées exclues', () => {
    expect(r.finished.map((x) => x.id)).toEqual(['A-18', 'A-13']);
    expect(r.finished.every((x) => !x.late && x.avancement === 'Terminée — à vérifier')).toBe(true);
    expect([...r.open, ...r.finished].map((x) => x.id)).not.toEqual(expect.arrayContaining(['A-14']));
    expect(r).toMatchObject({ count: 6, late: 2 });
  });
  it('ligne : libellé, avancement « en retard de N j », date cible, site court, lien vers la fiche', () => {
    expect(r.open[0]).toEqual({
      id: 'A-11', label: 'Action A-11', status: 'p40', avancement: '40 % — en retard de 13 j', dueOn: '2026-10-01', due: '01/10/2026',
      late: true, lateDays: 13, site: 'Site de [Ville B]', href: '/actions?action=A-11',
    });
    expect(r.open[2]).toMatchObject({ id: 'A-17', site: 'Site à compléter', avancement: '80 %', late: false });
    expect(r.finished[0].site).toBe('ville-c'); // site inconnu de la liste : identifiant
  });
  it('libellé = première ligne du détail ; aucune action → rappel vide', () => {
    expect(reminderRows([action('A-1', 'a_faire', '2026-11-01', 'ville-a', '  Remplacer le flexible\nDétail long')], TODAY, SITES).open[0].label).toBe('Remplacer le flexible');
    expect(reminderRows([action('A-2', 'reportee', '2026-11-01')], TODAY, SITES)).toEqual({ open: [], finished: [], count: 0, late: 0 });
  });
  it('avancements interrogés : les six ouvertes et Terminée', () => {
    expect(REMINDER_AVANCEMENTS).toEqual(['a_faire', 'initiee', 'p20', 'p40', 'p60', 'p80', 'terminee']);
  });
});

describe('semaine, clé, échéance d’envoi', () => {
  it('mercredi du rappel et semaine ISO', () => {
    expect(reminderWeek('2026-10-14')).toEqual({ day: '2026-10-14', week: '2026-W42' });
    expect(reminderWeek('2026-10-16')).toEqual({ day: '2026-10-14', week: '2026-W42' }); // vendredi
    expect(reminderWeek('2026-10-20')).toEqual({ day: '2026-10-14', week: '2026-W42' }); // mardi suivant
    expect(reminderWeek('2026-10-21')).toEqual({ day: '2026-10-21', week: '2026-W43' });
    expect(reminderWeek('2027-01-01')).toEqual({ day: '2026-12-30', week: '2026-W53' });
    expect(reminderKey('2026-W42')).toBe('rappel-actions|2026-W42');
  });
  it('dû le mercredi seulement, à partir de l’heure configurée (heure de Paris), jusqu’à 23:59', () => {
    const seven = { hour: 7, minute: 0 };
    expect(isReminderDue('2026-10-14', new Date('2026-10-14T05:30:00Z'), seven)).toBe(true); // 07:30 à Paris (UTC+2)
    expect(isReminderDue('2026-10-14', new Date('2026-10-14T04:59:00Z'), seven)).toBe(false); // 06:59
    expect(isReminderDue('2026-10-14', new Date('2026-10-14T05:00:00Z'), seven)).toBe(true); // 07:00
    expect(isReminderDue('2026-10-14', new Date('2026-10-14T21:59:00Z'), seven)).toBe(true); // 23:59
    expect(isReminderDue('2026-10-15', new Date('2026-10-15T08:00:00Z'), seven)).toBe(false); // jeudi : pas de rattrapage
    expect(isReminderDue('2026-11-04', new Date('2026-11-04T06:05:00Z'), seven)).toBe(true); // 07:05 à Paris (UTC+1)
    expect(isReminderDue('2026-11-04', new Date('2026-11-04T05:55:00Z'), seven)).toBe(false); // 06:55
    expect(isReminderDue('2026-10-14', new Date('2026-10-14T06:15:00Z'), { hour: 8, minute: 30 })).toBe(false);
  });
});

describe('e-mail du rappel', () => {
  const rows = reminderRows([
    action('A-11', 'p40', '2026-10-01', 'ville-b', 'Contrôler <les> flexibles & "raccords"'),
    action('A-10', 'a_faire', '2026-10-30'),
    action('A-13', 'terminee', '2026-09-01'),
  ], TODAY, SITES);
  const mail = renderReminderEmail({ person: { name: '[C. <Lefèvre>]' }, rows, baseUrl: 'https://vigie.exemple.fr', day: TODAY });

  it('objet et intitulé au format du § 15.2', () => {
    expect(mail.subject).toBe('Vigie · vos actions QSE en cours (3, dont 1 en retard)');
    expect(reminderSubject(0, 0)).toBe('Vigie · vos actions QSE en cours (0, dont 0 en retard)');
    expect(reminderTitle(5, 2)).toBe('Vos actions QSE en cours : 5, dont 2 en retard');
  });
  it('texte : deux groupes, retards signalés, liens vers chaque fiche et vers ses actions', () => {
    expect(mail.text).toContain('Bonjour [C. <Lefèvre>],');
    expect(mail.text).toContain('au mercredi 14/10/2026, sur tous les sites : 3, dont 1 en retard.');
    expect(mail.text.indexOf('Actions en cours')).toBeLessThan(mail.text.indexOf('A-11'));
    expect(mail.text.indexOf('A-11')).toBeLessThan(mail.text.indexOf('A-10'));
    expect(mail.text.indexOf('A-10')).toBeLessThan(mail.text.indexOf('Terminées — en attente de vérification'));
    expect(mail.text.indexOf('Terminées — en attente de vérification')).toBeLessThan(mail.text.indexOf('A-13'));
    expect(mail.text).toContain('  40 % — en retard de 13 j · date cible 01/10/2026 · Site de [Ville B]');
    expect(mail.text).toContain('  https://vigie.exemple.fr/actions?action=A-11');
    expect(mail.text).toContain(`Toutes vos actions : https://vigie.exemple.fr${REMINDER_HREF}`);
  });
  it('HTML : valeurs échappées, liens absolus, retard mis en évidence', () => {
    expect(mail.html).toContain('Contrôler &lt;les&gt; flexibles &amp; &quot;raccords&quot;');
    expect(mail.html).toContain('Bonjour [C. &lt;Lefèvre&gt;],');
    expect(mail.html).not.toContain('<les>');
    expect(mail.html).toContain('<a href="https://vigie.exemple.fr/actions?action=A-11">A-11</a>');
    expect(mail.html).toContain('<a href="https://vigie.exemple.fr/actions?mes=1">');
    expect(mail.html).toMatch(/color:#b91c1c;font-weight:600">40 % — en retard de 13 j</);
    expect(mail.html).toContain('Terminées — en attente de vérification');
  });
  it('groupe vide omis', () => {
    const onlyOpen = renderReminderEmail({ person: { name: 'X' }, rows: reminderRows([action('A-1', 'a_faire', '2026-11-01')], TODAY, SITES), baseUrl: 'http://localhost:3200', day: TODAY });
    expect(onlyOpen.text).not.toContain('Terminées — en attente');
    expect(onlyOpen.html).not.toContain('Terminées — en attente');
  });
});
