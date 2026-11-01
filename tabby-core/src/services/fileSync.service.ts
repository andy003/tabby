import { Injectable, NgZone } from '@angular/core'
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'

export type FileSyncState = 'downloading'|'pending'|'uploading'|'synced'|'error'|'disconnected'

export interface FileSyncEntry {
    owner: object
    remotePath: string
    name: string
    connection: string
    state: FileSyncState
    updatedAt: Date
    syncedAt?: Date
    error?: string
    localPath?: string
    retry?: () => Promise<void>
    openLocal?: () => Promise<void>
}

/** Shared status of remote files opened in local editors. */
@Injectable({ providedIn: 'root' })
export class FileSyncService {
    entries: FileSyncEntry[] = []
    private owners = new WeakMap<object, object>()

    constructor (private zone: NgZone) { }

    find (owner: object, remotePath: string): FileSyncEntry|undefined {
        const identity = this.owners.get(owner)
        return this.entries.find(entry => entry.owner === identity && entry.remotePath === remotePath)
    }

    register (owner: object, remotePath: string, name: string, connection: string): FileSyncEntry {
        let identity = this.owners.get(owner)
        if (!identity) {
            identity = {}
            this.owners.set(owner, identity)
        }
        const entry: FileSyncEntry = { owner: identity, remotePath, name, connection, state: 'downloading', updatedAt: new Date() }
        this.zone.run(() => this.entries.push(entry))
        return entry
    }

    update (entry: FileSyncEntry, state: FileSyncState, error?: string): void {
        this.zone.run(() => {
            entry.state = state
            entry.error = error
            entry.updatedAt = new Date()
            if (state === 'synced') { entry.syncedAt = entry.updatedAt }
        })
    }

    get summary (): FileSyncEntry|undefined {
        const priority: Record<FileSyncState, number> = { error: 5, pending: 4, uploading: 3, downloading: 2, disconnected: 1, synced: 0 }
        return [...this.entries].sort((a, b) => priority[b.state] - priority[a.state] || b.updatedAt.getTime() - a.updatedAt.getTime())[0]
    }

    label (entry: FileSyncEntry): string {
        const labels: Record<FileSyncState, string> = {
            downloading: _('Downloading for editing'), pending: _('Not synced'), uploading: _('Syncing'),
            synced: _('Synced'), error: _('Sync failed'), disconnected: _('Sync stopped: disconnected'),
        }
        return labels[entry.state]
    }

    icon (entry: FileSyncEntry): string {
        const icons: Record<FileSyncState, string> = {
            downloading: 'fas fa-spinner fa-spin', pending: 'far fa-clock', uploading: 'fas fa-sync-alt fa-spin',
            synced: 'fas fa-circle-check', error: 'fas fa-circle-exclamation', disconnected: 'fas fa-link-slash',
        }
        return icons[entry.state]
    }
}
