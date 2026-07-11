import { SetMetadata } from '@nestjs/common';

export const REQUIRE_MINISTRY_LEADER_KEY = 'requireMinistryLeader';

/**
 * Tells MinistryLeaderGuard where to find the target ministry. Exactly one of:
 * - ministryId: taken directly from the GraphQL args
 * - membershipId: resolved to its ministry via DB lookup
 * - ministrySlug: fixed slug (e.g. 'acogida' for createUser)
 */
export interface MinistryTargetRef {
  ministryId?: string;
  membershipId?: string;
  ministrySlug?: string;
}

export type MinistryTargetExtractor = (args: Record<string, unknown>) => MinistryTargetRef;

/**
 * Restricts a resolver to pastors OR active leaders of the target ministry.
 * Enforced by the global MinistryLeaderGuard.
 */
export const RequireMinistryLeader = (extract: MinistryTargetExtractor) =>
  SetMetadata(REQUIRE_MINISTRY_LEADER_KEY, extract);
