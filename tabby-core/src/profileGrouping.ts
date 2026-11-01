import type { PartialProfile, PartialProfileGroup, Profile, ProfileGroup } from './api/profileProvider'

/** Move a saved session without replacing its connection options or other settings. */
export function moveProfileToGroup (
    profiles: PartialProfile<Profile>[],
    groups: PartialProfileGroup<ProfileGroup>[],
    profileId: string,
    targetGroupId: string|null,
): boolean {
    const profile = profiles.find(p => p.id === profileId)
    if (!profile || profile.isBuiltin === true || profile.isTemplate === true) { return false }
    if (targetGroupId !== null && !groups.some(g => g.id === targetGroupId)) { return false }
    const groupId = targetGroupId ?? ''
    if ((profile.group ?? '') === groupId) { return false }
    profile.group = groupId
    return true
}
