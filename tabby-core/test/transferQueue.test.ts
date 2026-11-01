import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DirectoryUpload, TransferTask } from '../src/api/platform.ts'
import { failTransferTree, getTransferSummary, runTransferJobs } from '../src/transferQueue.ts'

class TestFile extends TransferTask {
    closed = false

    constructor (name: string, size = 0) { super(name, size, 'upload') }

    progress (bytes: number): void { this.increaseProgress(bytes) }

    close (): void { this.closed = true }
}

describe('Explicit file transfer results', () => {
    it('does not mark empty files successful before they transfer', () => {
        const file = new TestFile('empty.txt')
        assert.equal(file.isComplete(), false)
        assert.equal(file.getState(), 'queued')
        file.setStarted()
        assert.equal(file.isComplete(), false)
        file.setCompleted(true)
        assert.equal(file.isComplete(), true)
    })

    it('waits for server commit even when every byte has been read', () => {
        const file = new TestFile('config.txt', 5)
        file.setStarted()
        file.progress(5)
        assert.equal(file.getCompletedBytes(), 5)
        assert.equal(file.isComplete(), false)
        file.setFailed('Rename rejected')
        assert.equal(file.isFailed(), true)
        assert.equal(file.isComplete(), false)
        assert.equal(file.getError(), 'Rename rejected')
    })

    it('keeps cancellation distinct from failure and success', () => {
        const file = new TestFile('cancelled.txt')
        file.cancel()
        file.setFailed('File closed')
        file.setCompleted(true)
        assert.equal(file.getState(), 'cancelled')
        assert.equal(file.closed, true)
    })
})

describe('Directory transfer queues', () => {
    it('does not finish a directory before its queued children finish', () => {
        const root = new DirectoryUpload('project')
        const file = new TestFile('main.ts')
        root.pushChildren(file as any)
        root.setStarted()
        root.setCompleted(true)
        assert.equal(root.getState(), 'running')
        file.setCompleted(true)
        root.setCompleted(true)
        assert.equal(root.isComplete(), true)
    })

    it('continues after a failure and records every file result', async () => {
        const files = [new TestFile('one.txt'), new TestFile('bad.txt'), new TestFile('last.txt')]
        const ran: string[] = []
        await runTransferJobs(files.map(file => ({ transfer: file, run: async () => {
            ran.push(file.getName())
            if (file.getName() === 'bad.txt') throw Error('Permission denied')
        } })))
        assert.deepEqual(ran, ['one.txt', 'bad.txt', 'last.txt'])
        assert.deepEqual(files.map(file => file.getState()), ['completed', 'failed', 'completed'])
        assert.deepEqual(getTransferSummary(files), { queued: 0, running: 0, completed: 2, failed: 1, cancelled: 0 })
    })

    it('cancels remaining queued files without running them', async () => {
        const files = [new TestFile('first.txt'), new TestFile('second.txt'), new TestFile('third.txt')]
        let cancel = false
        const ran: string[] = []
        await runTransferJobs(files.map(file => ({ transfer: file, run: async () => {
            ran.push(file.getName())
            cancel = true
        } })), () => cancel)
        assert.deepEqual(ran, ['first.txt'])
        assert.deepEqual(files.map(file => file.getState()), ['completed', 'cancelled', 'cancelled'])
    })

    it('aggregates nested files without double-counting directory rows', () => {
        const root = new DirectoryUpload('project')
        const nested = new DirectoryUpload('src')
        const first = new TestFile('main.ts', 100)
        const second = new TestFile('config.json', 50)
        nested.pushChildren(first as any)
        root.pushChildren(nested)
        root.pushChildren(second as any)
        first.progress(100)
        first.setCompleted(true)
        second.setFailed('Disk full')
        assert.equal(root.getSize(), 150)
        assert.equal(root.getCompletedBytes(), 100)
        assert.deepEqual(getTransferSummary([root]), { queued: 0, running: 0, completed: 1, failed: 1, cancelled: 0 })
    })

    it('marks all affected files failed when a destination directory cannot be created', () => {
        const root = new DirectoryUpload('blocked')
        const file = new TestFile('keep.txt')
        root.pushChildren(file as any)
        failTransferTree(root, 'Cannot create directory')
        assert.equal(root.isFailed(), true)
        assert.equal(file.isFailed(), true)
        assert.equal(file.getError(), 'Cannot create directory')
        assert.equal(file.closed, true)
    })

    it('cancels all descendants and also cancels late-discovered children', () => {
        const root = new DirectoryUpload('project')
        const nested = new DirectoryUpload('src')
        const file = new TestFile('main.ts')
        nested.pushChildren(file as any)
        root.pushChildren(nested)
        root.cancel()
        const late = new TestFile('late.txt')
        root.pushChildren(late as any)
        assert.equal(nested.isCancelled(), true)
        assert.equal(file.isCancelled(), true)
        assert.equal(late.isCancelled(), true)
    })
})
