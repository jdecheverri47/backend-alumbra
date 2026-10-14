import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { AccessRequest, AccessRequestStatus } from '@prisma/client';

registerEnumType(AccessRequestStatus, { name: 'AccessRequestStatus' });

export { AccessRequestStatus };

@ObjectType('AccessRequest')
export class AccessRequestModel {
  @Field(() => ID)
  id!: string;

  @Field()
  email!: string;

  @Field()
  firstName!: string;

  @Field()
  lastName!: string;

  @Field(() => String, { nullable: true })
  photoUrl?: string | null;

  @Field(() => String, { nullable: true })
  phone?: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'Lo que la persona escribió al pedir acceso.',
  })
  note?: string | null;

  @Field(() => AccessRequestStatus)
  status!: AccessRequestStatus;

  @Field({ description: 'El correo ya era de una persona registrada sin acceso.' })
  isExistingUser!: boolean;

  @Field()
  createdAt!: Date;

  @Field(() => Date, { nullable: true })
  reviewedAt?: Date | null;
}

export function toAccessRequestModel(r: AccessRequest): AccessRequestModel {
  return {
    id: r.id,
    email: r.email,
    firstName: r.firstName,
    lastName: r.lastName,
    photoUrl: r.photoUrl,
    phone: r.phone,
    note: r.note,
    status: r.status,
    isExistingUser: r.userId !== null && r.status === 'PENDING',
    createdAt: r.createdAt,
    reviewedAt: r.reviewedAt,
  };
}
