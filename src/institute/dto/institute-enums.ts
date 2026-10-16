import { registerEnumType } from '@nestjs/graphql';
import {
  InstituteAttachmentKind,
  InstituteItemKind,
  InstituteRole,
  InstituteSubmissionState,
} from '@prisma/client';

registerEnumType(InstituteRole, { name: 'InstituteRole' });
registerEnumType(InstituteItemKind, { name: 'InstituteItemKind' });
registerEnumType(InstituteAttachmentKind, { name: 'InstituteAttachmentKind' });
registerEnumType(InstituteSubmissionState, { name: 'InstituteSubmissionState' });

/** Lo que ve el profesor: si los alumnos ya la ven. */
export enum InstituteItemStatus {
  DRAFT = 'DRAFT',
  SCHEDULED = 'SCHEDULED',
  PUBLISHED = 'PUBLISHED',
}
registerEnumType(InstituteItemStatus, { name: 'InstituteItemStatus' });

export { InstituteAttachmentKind, InstituteItemKind, InstituteRole, InstituteSubmissionState };
