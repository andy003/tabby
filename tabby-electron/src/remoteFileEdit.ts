import { watch, FSWatcher, promises as fs } from 'fs'
import * as path from 'path'
import { createHash, randomUUID } from 'crypto'
import type { FileSyncState } from 'tabby-core'

interface RemoteEditOptions {
    localPath: string
    upload: (snapshot: Buffer) => Promise<void>
    onState: (state: FileSyncState, error?: string) => void
    debounceMs?: number
}

/** Watches the directory so editors that save by replacing the file keep working. */
export class RemoteFileEdit {
    private watcher: FSWatcher
    private timer: ReturnType<typeof setTimeout>|undefined
    private running: Promise<void>|undefined
    private stopped = false
    private syncedHash: string

    private constructor (private options: RemoteEditOptions, initial: Buffer) {
        this.syncedHash = this.hash(initial)
        this.watcher = watch(path.dirname(options.localPath), (_event, filename) => {
            if (filename !== null && filename.toString() !== path.basename(options.localPath)) { return }
            this.changed()
        })
        this.watcher.on('error', error => {
            this.options.onState('error', error.message)
        })
        this.options.onState('synced')
    }

    static async start (options: RemoteEditOptions): Promise<RemoteFileEdit> {
        return new RemoteFileEdit(options, await fs.readFile(options.localPath))
    }

    private hash (data: Buffer): string {
        return createHash('sha256').update(data).digest('hex')
    }

    private changed (): void {
        if (this.stopped) { return }
        this.options.onState('pending')
        clearTimeout(this.timer)
        this.timer = setTimeout(() => { this.flush() }, this.options.debounceMs ?? 600)
    }

    async flush (): Promise<void> {
        clearTimeout(this.timer)
        if (this.stopped) { return }
        if (this.running) { return this.running }
        this.running = this.synchronize().finally(() => { this.running = undefined })
        return this.running
    }

    private async synchronize (): Promise<void> {
        try {
            while (!this.stopped) {
                const before = await fs.stat(this.options.localPath)
                const snapshot = await fs.readFile(this.options.localPath)
                const after = await fs.stat(this.options.localPath)
                if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || snapshot.length !== after.size) {
                    this.changed()
                    return
                }
                const hash = this.hash(snapshot)
                if (hash === this.syncedHash) {
                    // A disconnect can occur during awaited filesystem operations.
                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                    if (!this.stopped) { this.options.onState('synced') }
                    return
                }
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                if (this.stopped) { return }
                this.options.onState('uploading')
                await this.options.upload(snapshot)
                this.syncedHash = hash
                // Read again before reporting success, including saves made during upload.
            }
        } catch (error) {
            if (!this.stopped) { this.options.onState('error', error instanceof Error ? error.message : String(error)) }
        }
    }

    stop (): void {
        if (this.stopped) { return }
        this.stopped = true
        clearTimeout(this.timer)
        this.watcher.close()
        this.options.onState('disconnected')
    }
}

export interface RemoteFileOperations {
    upload: (remotePath: string, snapshot: Buffer) => Promise<void>
    rename: (from: string, to: string) => Promise<void>
    unlink: (remotePath: string) => Promise<void>
    chmod: (remotePath: string, mode: number) => Promise<void>
    verify?: () => Promise<void>
}

/** Keep the original remote file until a complete, permissioned replacement is ready. */
export async function replaceRemoteFile (remote: RemoteFileOperations, remotePath: string, snapshot: Buffer, mode: number): Promise<void> {
    const staged = `${remotePath}.tabby-edit-${randomUUID()}`
    const backup = staged + '.backup'
    let moved = false
    let committed = false
    try {
        await remote.upload(staged, snapshot)
        await remote.chmod(staged, mode & 0o7777)
        await remote.verify?.()
        await remote.rename(remotePath, backup)
        moved = true
        await remote.rename(staged, remotePath)
        committed = true
    } catch (error) {
        if (moved && !committed) {
            try {
                await remote.rename(backup, remotePath)
            } catch {
                throw new Error(`${String(error)}. Original remote file preserved at: ${backup}`)
            }
        }
        throw error
    } finally {
        await remote.unlink(staged).catch(() => null)
        if (committed) { await remote.unlink(backup).catch(() => null) }
    }
}
