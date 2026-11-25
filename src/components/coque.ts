// Coque commune de la suite (Norma 2.3, norma/charte/COQUE.md) : composants de norma/charte/ds repris ici pour que
// l'application n'importe la copie de Norma qu'à un seul endroit (comme src/lib/theme.ts). Classes : norma/charte/coque.css.
export { AppShell, MobileTopBar, useCoque } from '@norma/charte/ds/AppShell';
export { Sidebar, PageSearch, NavSections, NavSection, type PageHit } from '@norma/charte/ds/Sidebar';
export { PageHeader as CoquePageHeader } from '@norma/charte/ds/PageHeader';
export { PrefsStack } from '@norma/charte/ds/HeaderTools';
export { useHeaderMenu } from '@norma/charte/ds/HeaderActions';
export { useIsClient } from '@norma/charte/ds/overlay';
export { ToolLogo } from '@norma/charte/ds/ToolLogo';
