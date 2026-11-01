import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { moveProfileToGroup } from '../src/profileGrouping.ts'
import type { PartialProfile, Profile } from '../src/api/profileProvider.ts'

const groups = [
    { id: 'production', name: 'Production' },
    { id: 'databases', name: 'Databases', parentGroupId: 'production' },
]

function session (overrides: Partial<PartialProfile<Profile>> = {}): PartialProfile<Profile> {
    return {
        id: 'ssh:saved', type: 'ssh', name: 'Database', group: '',
        options: { host: 'localhost', port: 2222, privateKeys: ['file:///test/key'] },
        color: '#458ec1', disableDynamicTitle: true, ...overrides,
    }
}

describe('Moving saved sessions between profile groups', () => {
    it('moves to a nested group while preserving all connection settings', () => {
        const profile = session({ group: 'production' })
        const before = structuredClone(profile)
        const options = profile.options
        assert.equal(moveProfileToGroup([profile], groups, profile.id!, 'databases'), true)
        assert.deepEqual(profile, { ...before, group: 'databases' })
        assert.equal(profile.options, options)
    })

    it('moves a session back to Ungrouped', () => {
        const profile = session({ group: 'databases' })
        assert.equal(moveProfileToGroup([profile], groups, profile.id!, null), true)
        assert.equal(profile.group, '')
    })

    it('rejects a deleted destination without changing the session', () => {
        const profile = session({ group: 'production' })
        const before = structuredClone(profile)
        assert.equal(moveProfileToGroup([profile], groups, profile.id!, 'deleted-group'), false)
        assert.deepEqual(profile, before)
    })

    it('does not change other saved sessions or synthesize an imported session', () => {
        const profile = session()
        const before = structuredClone(profile)
        assert.equal(moveProfileToGroup([profile], groups, 'ssh:imported', 'production'), false)
        assert.deepEqual(profile, before)
    })

    it('protects built-in profiles and templates from modification', () => {
        for (const flags of [{ isBuiltin: true }, { isTemplate: true }]) {
            const profile = session(flags)
            const before = structuredClone(profile)
            assert.equal(moveProfileToGroup([profile], groups, profile.id!, 'production'), false)
            assert.deepEqual(profile, before)
        }
    })

    it('treats drops into the current group as a no-op', () => {
        const profile = session({ group: 'production' })
        assert.equal(moveProfileToGroup([profile], groups, profile.id!, 'production'), false)
        const ungrouped = session()
        delete ungrouped.group
        assert.equal(moveProfileToGroup([ungrouped], groups, ungrouped.id!, null), false)
        assert.equal(ungrouped.group, undefined)
    })
})
