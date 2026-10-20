import { InstituteItem } from '@prisma/client';
import { formatDay } from '../common/format-date';
import { NotifyInput } from '../notifications/notifications.service';

const WHAT = { MATERIAL: 'Material nuevo', ASSIGNMENT: 'Tarea nueva', EXAM: 'Examen nuevo' };

/**
 * El aviso de algo recién publicado. Lo usan el Instituto (al publicar) y los
 * recordatorios (lo programado, cuando llega su hora).
 */
export function contentNotice(
  item: Pick<InstituteItem, 'id' | 'kind' | 'title' | 'dueAt'>,
  moduleTitle: string,
  studentIds: string[],
  actorId: string | null,
): NotifyInput {
  return {
    type: 'instituto.contenido.nuevo',
    to: studentIds,
    title: `${WHAT[item.kind]}: ${item.title}`,
    body: item.dueAt ? `${moduleTitle} · entrega hasta el ${formatDay(item.dueAt)}` : moduleTitle,
    href: `/instituto?item=${item.id}`,
    actorId,
    data: { refId: item.id },
  };
}
