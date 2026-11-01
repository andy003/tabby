import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { RemoteFileEdit, replaceRemoteFile } from '../src/remoteFileEdit.ts'
import type { RemoteFileOperations } from '../src/remoteFileEdit.ts'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until (check: () => boolean): Promise<void> {
    for (let i = 0; i < 120; i++) {
        if (check()) { return }
        await delay(20)
    }
    assert.fail('Timed out waiting for file synchronization')
}

async function fixture (t: any, upload: (snapshot: Buffer) => Promise<void>) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tabby-sync-test-'))
    const localPath = path.join(directory, 'config.txt')
    await fs.writeFile(localPath, 'original')
    const states: string[] = []
    const errors: string[] = []
    const editor = await RemoteFileEdit.start({
        localPath, upload, debounceMs: 25,
        onState: (state, error) => { states.push(state); if (error) errors.push(error) },
    })
    t.after(async () => { editor.stop(); await fs.rm(directory, { recursive: true, force: true }) })
    return { editor, localPath, directory, states, errors }
}

describe('Remote file editing synchronization', () => {
    it('automatically uploads a save and reports success only after upload completes', async t => {
        const uploaded: string[] = []
        const f = await fixture(t, async data => { await delay(30); uploaded.push(data.toString()) })
        await fs.writeFile(f.localPath, 'saved')
        await until(() => uploaded.length === 1 && f.states.at(-1) === 'synced')
        assert.deepEqual(uploaded, ['saved'])
        assert(f.states.includes('pending'))
        assert(f.states.includes('uploading'))
    })

    it('keeps monitoring repeated atomic replacement saves', async t => {
        const uploaded: string[] = []
        const f = await fixture(t, async data => { uploaded.push(data.toString()) })
        for (const text of ['first replacement', 'second replacement']) {
            const staged = path.join(f.directory, 'editor-save.tmp')
            await fs.writeFile(staged, text)
            await fs.rename(staged, f.localPath)
            await until(() => uploaded.at(-1) === text && f.states.at(-1) === 'synced')
        }
        assert.deepEqual(uploaded, ['first replacement', 'second replacement'])
    })

    it('serializes uploads and sends a newer save made during an upload', async t => {
        const uploaded: string[] = []
        let release!: () => void
        const gate = new Promise<void>(resolve => { release = resolve })
        const f = await fixture(t, async data => {
            uploaded.push(data.toString())
            if (uploaded.length === 1) await gate
        })
        await fs.writeFile(f.localPath, 'first')
        await until(() => uploaded.length === 1)
        await fs.writeFile(f.localPath, 'latest')
        await delay(80)
        assert.deepEqual(uploaded, ['first'])
        release()
        await until(() => uploaded.length === 2 && f.states.at(-1) === 'synced')
        assert.deepEqual(uploaded, ['first', 'latest'])
    })

    it('keeps a failed save locally and supports retrying it', async t => {
        let attempts = 0
        const f = await fixture(t, async () => { if (++attempts === 1) throw Error('Permission denied') })
        await fs.writeFile(f.localPath, 'keep these edits')
        await until(() => f.states.at(-1) === 'error')
        assert.equal(await fs.readFile(f.localPath, 'utf8'), 'keep these edits')
        assert.equal(f.errors.at(-1), 'Permission denied')
        await f.editor.flush()
        assert.equal(f.states.at(-1), 'synced')
        assert.equal(attempts, 2)
    })

    it('does not reupload unchanged contents', async t => {
        const uploaded: Buffer[] = []
        const f = await fixture(t, async data => { uploaded.push(data) })
        await fs.writeFile(f.localPath, 'original')
        await delay(100)
        await f.editor.flush()
        assert.equal(uploaded.length, 0)
    })

    it('does not claim success after a connection closes during upload', async t => {
        let started = false
        let release!: () => void
        const gate = new Promise<void>(resolve => { release = resolve })
        const f = await fixture(t, async () => { started = true; await gate })
        await fs.writeFile(f.localPath, 'unsynced local data')
        const upload = f.editor.flush()
        await until(() => started)
        f.editor.stop()
        release()
        await upload
        assert.equal(f.states.at(-1), 'disconnected')
        assert.equal(await fs.readFile(f.localPath, 'utf8'), 'unsynced local data')
    })
})

function remoteFixture () {
    const files = new Map<string, string>([['/remote/config', 'original']])
    const modes: number[] = []
    const remote: RemoteFileOperations = {
        upload: async (name, bytes) => { files.set(name, bytes.toString()) },
        rename: async (from, to) => {
            assert(files.has(from), 'Rename source exists')
            files.set(to, files.get(from)!)
            files.delete(from)
        },
        unlink: async name => { files.delete(name) },
        chmod: async (_name, mode) => { modes.push(mode) },
    }
    return { files, modes, remote }
}

describe('Replacing an edited remote file', () => {
    it('installs the complete snapshot with original permissions', async () => {
        const f = remoteFixture()
        await replaceRemoteFile(f.remote, '/remote/config', Buffer.from('new contents'), 0o100640)
        assert.deepEqual([...f.files], [['/remote/config', 'new contents']])
        assert.deepEqual(f.modes, [0o640])
    })

    it('retains the original when staging fails', async () => {
        const f = remoteFixture()
        f.remote.upload = async () => { throw Error('No space left') }
        await assert.rejects(replaceRemoteFile(f.remote, '/remote/config', Buffer.from('new'), 0o600), /No space/)
        assert.deepEqual([...f.files], [['/remote/config', 'original']])
    })

    it('restores the original when installing the replacement fails', async () => {
        const f = remoteFixture()
        const rename = f.remote.rename
        f.remote.rename = async (from, to) => {
            if (to === '/remote/config' && !from.endsWith('.backup')) throw Error('Rename rejected')
            await rename(from, to)
        }
        await assert.rejects(replaceRemoteFile(f.remote, '/remote/config', Buffer.from('new'), 0o600), /Rename rejected/)
        assert.deepEqual([...f.files], [['/remote/config', 'original']])
    })

    it('checks for remote changes after staging and leaves the original in place on conflict', async () => {
        const f = remoteFixture()
        f.remote.verify = async () => {
            assert.equal(f.files.size, 2, 'Complete replacement is staged before verification')
            throw Error('Remote contents changed')
        }
        await assert.rejects(replaceRemoteFile(f.remote, '/remote/config', Buffer.from('new'), 0o600), /Remote contents changed/)
        assert.deepEqual([...f.files], [['/remote/config', 'original']])
    })

    it('keeps the backup and reports its path if rollback also fails', async () => {
        const f = remoteFixture()
        const rename = f.remote.rename
        f.remote.rename = async (from, to) => {
            if (to === '/remote/config') throw Error('Connection closed')
            await rename(from, to)
        }
        await assert.rejects(replaceRemoteFile(f.remote, '/remote/config', Buffer.from('new'), 0o600), /Original remote file preserved at: .*\.backup/)
        assert.equal(f.files.size, 1)
        assert.equal([...f.files.values()][0], 'original')
    })
})
