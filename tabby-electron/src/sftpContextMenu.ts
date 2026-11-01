import * as fs from 'fs/promises'
import * as path from 'path'
import { createHash } from 'crypto'
import { spawn } from 'child_process'
import { execFile } from 'mz/child_process'
import { OPEN_READ } from 'russh'
import { Injectable } from '@angular/core'
import { merge, take } from 'rxjs'
import { ConfigService, FileUpload, FileSyncEntry, FileSyncService, MenuItemOptions, NotificationsService, TranslateService } from 'tabby-core'
import { SFTPFile, SFTPPanelComponent, SFTPContextMenuItemProvider, SFTPSession } from 'tabby-ssh'
import { ElectronPlatformService, resolveInsideBase } from './services/platform.service'
import { ElectronService } from './services/electron.service'
import { RemoteFileEdit, replaceRemoteFile } from './remoteFileEdit'

interface OpenEditor {
    closed: boolean
    controller?: RemoteFileEdit
    opening?: Promise<void>
}

class SnapshotUpload extends FileUpload {
    private position = 0

    constructor (private name: string, private data: Buffer, private mode: number) { super() }

    getName (): string { return this.name }

    getSize (): number { return this.data.length }

    getMode (): number { return this.mode }

    async read (): Promise<Uint8Array> {
        const chunk = this.data.subarray(this.position, this.position + 256 * 1024)
        this.position += chunk.length
        this.increaseProgress(chunk.length)
        return chunk
    }

    close (): void { /* The upload owns an immutable in-memory snapshot. */ }
}

/** @hidden */
@Injectable()
export class EditSFTPContextMenu extends SFTPContextMenuItemProvider {
    weight = 0
    supportsEditing = true
    private editors = new Map<FileSyncEntry, OpenEditor>()

    constructor (
        private translate: TranslateService,
        private platform: ElectronPlatformService,
        private electron: ElectronService,
        private files: FileSyncService,
        private notifications: NotificationsService,
        private config: ConfigService,
    ) { super() }

    async getItems (item: SFTPFile, panel: SFTPPanelComponent): Promise<MenuItemOptions[]> {
        const items: MenuItemOptions[] = [{
            click: () => this.platform.setClipboard({ text: item.fullPath }),
            label: this.translate.instant('Copy full path'),
        }]
        if (!item.isDirectory) {
            items.push({ click: () => panel.edit(item), label: this.translate.instant('Edit locally') })
            items.push({
                label: this.translate.instant('Open with'),
                submenu: [
                    {
                        type: 'radio', label: this.translate.instant('System text editor'),
                        checked: this.config.store.ssh.fileEditor === 'system',
                        click: () => this.useEditor('system', item, panel),
                    },
                    {
                        type: 'radio', label: this.translate.instant('Visual Studio Code'),
                        checked: this.config.store.ssh.fileEditor === 'vscode',
                        click: () => this.useEditor('vscode', item, panel),
                    },
                    ...this.config.store.ssh.fileEditorPath ? [{
                        type: 'radio' as const, label: this.config.store.ssh.fileEditorPath,
                        checked: this.config.store.ssh.fileEditor === 'custom',
                        click: () => this.useEditor('custom', item, panel),
                    }] : [],
                    { type: 'separator' },
                    { label: this.translate.instant('Choose application'), click: () => this.useEditor('custom', item, panel, true) },
                ],
            })
        }
        return items
    }

    private async useEditor (editor: string, item: SFTPFile, panel: SFTPPanelComponent, browse = false): Promise<void> {
        const previousEditor = this.config.store.ssh.fileEditor
        const previousPath = this.config.store.ssh.fileEditorPath
        try {
            const selected = browse ? await this.platform.pickApplication() : previousPath
            if (browse && !selected) { return }
            this.config.store.ssh.fileEditor = editor
            if (browse) { this.config.store.ssh.fileEditorPath = selected }
            try {
                await this.config.save()
            } catch (error) {
                this.config.store.ssh.fileEditor = previousEditor
                this.config.store.ssh.fileEditorPath = previousPath
                throw error
            }
        } catch (error) {
            this.notifications.error(this.translate.instant('Could not save editor settings'), String(error))
            return
        }
        await panel.edit(item)
    }

    async editFile (item: SFTPFile, panel: SFTPPanelComponent): Promise<boolean> {
        let entry = this.files.find(panel.session, item.fullPath)
        if (!entry) {
            const profile = panel.session.profile
            entry = this.files.register(panel.session, item.fullPath, item.name, `${profile.options.host}:${profile.options.port}`)
            const tracked = entry
            merge(panel.session.willDestroy$, panel.sftp.closed$).pipe(take(1)).subscribe(() => {
                const current = this.editors.get(tracked)
                if (current) {
                    current.closed = true
                    current.controller?.stop()
                }
                this.editors.delete(tracked)
                tracked.retry = undefined
                this.files.update(tracked, 'disconnected')
            })
        }
        let editor = this.editors.get(entry)
        if (!editor) {
            editor = { closed: false }
            this.editors.set(entry, editor)
        }
        if (editor.opening) {
            await editor.opening
        } else if (editor.controller) {
            await entry.openLocal?.()
        } else {
            const tracked = entry
            tracked.retry = async () => { await this.editFile(item, panel) }
            editor.opening = this.startEditing(item, panel, tracked, editor)
            try {
                await editor.opening
            } catch (error) {
                this.files.update(tracked, editor.closed ? 'disconnected' : 'error', String(error))
                throw error
            } finally {
                editor.opening = undefined
            }
        }
        return true
    }

    private async resolveTarget (item: SFTPFile, sftp: SFTPSession): Promise<string> {
        let target = item.fullPath
        let link = item.isSymlink
        const visited = new Set<string>()
        while (link) {
            if (visited.has(target) || visited.size >= 32) { throw new Error(this.translate.instant('Symbolic link loop')) }
            visited.add(target)
            target = path.posix.resolve(path.posix.dirname(target), await sftp.readlink(target))
            const siblings = await sftp.readdir(path.posix.dirname(target))
            const basename = path.posix.basename(target)
            const next = siblings.find(file => file.name === basename)
            if (!next) { throw new Error(this.translate.instant('Remote file not found')) }
            link = next.isSymlink
        }
        return target
    }

    private async openLocalPath (localPath: string): Promise<void> {
        // Select a text editor explicitly: the original name may be a script or
        // have no extension, so its normal file association is not an editor.
        let command = 'open'
        let args = ['-t', localPath]
        let waitForExit = process.platform !== 'win32'
        const editor = this.config.store.ssh.fileEditor
        if (editor === 'custom') {
            const application = this.config.store.ssh.fileEditorPath.trim().replace(/^"(.*)"$/, '$1')
            if (!application) { throw new Error(this.translate.instant('Choose an editor application in SSH settings.')) }
            if (process.platform === 'darwin' && application.endsWith('.app')) {
                args = ['-a', application, localPath]
            } else {
                command = application
                args = [localPath]
                waitForExit = false
            }
        } else if (editor === 'vscode') {
            if (process.platform === 'darwin') {
                args = ['-a', 'Visual Studio Code', localPath]
            } else {
                command = process.platform === 'win32' ? await this.findVSCode() : 'code'
                args = ['--reuse-window', localPath]
                waitForExit = false
            }
        } else if (process.platform === 'win32') {
            command = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'notepad.exe')
            args = [localPath]
        } else if (process.platform !== 'darwin') {
            const [desktop] = await execFile('xdg-mime', ['query', 'default', 'text/plain'])
            if (!desktop.trim()) { throw new Error(this.translate.instant('Could not open local editor')) }
            command = 'gtk-launch'
            args = [desktop.trim(), localPath]
        }
        if (waitForExit) {
            await execFile(command, args)
            return
        }
        await new Promise<void>((resolve, reject) => {
            const child = spawn(command, args, { detached: true, stdio: 'ignore' })
            child.once('error', reject)
            child.once('spawn', () => { child.unref(); resolve() })
        })
    }

    private async findVSCode (): Promise<string> {
        const candidates = [
            ...process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe')] : [],
            ...[process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter((base): base is string => !!base)
                .map(base => path.join(base, 'Microsoft VS Code', 'Code.exe')),
            ...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean).flatMap(base => [path.join(base, 'Code.exe'), path.resolve(base, '..', 'Code.exe')]),
        ]
        for (const candidate of candidates) {
            if ((await fs.stat(candidate).catch(() => null))?.isFile()) { return candidate }
        }
        throw new Error(this.translate.instant('VS Code was not found. Choose its application in SSH settings.'))
    }

    private async startEditing (item: SFTPFile, panel: SFTPPanelComponent, entry: FileSyncEntry, editor: OpenEditor): Promise<void> {
        this.files.update(entry, 'downloading')
        const sftp = panel.sftp
        const connected = () => !editor.closed && panel.session.open
        const target = await this.resolveTarget(item, sftp)
        // Directory entries retain permissions and timestamps that russh.stat omits.
        const readVersion = async () => {
            const entries = await sftp.readdir(path.posix.dirname(target))
            const file = entries.find(candidate => candidate.name === path.posix.basename(target))
            if (!file) { throw new Error(this.translate.instant('Remote file not found')) }
            return file
        }
        let remoteVersion = await readVersion()
        const remoteHash = async () => {
            const hash = createHash('sha256')
            const handle = await sftp.open(target, OPEN_READ)
            try {
                while (true) {
                    const bytes = await handle.read()
                    if (!bytes.length) { break }
                    hash.update(bytes)
                }
            } finally {
                await handle.close()
            }
            return hash.digest('hex')
        }
        if (remoteVersion.isDirectory) { throw new Error(this.translate.instant('Cannot edit a directory')) }
        const cache = path.join(this.electron.app.getPath('userData'), 'remote-edits')
        await fs.mkdir(cache, { recursive: true, mode: 0o700 })
        const directory = await fs.mkdtemp(path.join(cache, 'edit-'))
        const localPath = resolveInsideBase(directory, item.name)
        entry.localPath = localPath
        const transfer = await this.platform.startDownload(item.name, 0o600, remoteVersion.size, localPath, { showInTransfers: false })
        if (!transfer) { throw new Error(this.translate.instant('Download cancelled')) }
        await sftp.download(target, transfer)
        await fs.chmod(localPath, 0o600)
        const contents = await fs.readFile(localPath)
        let expectedHash = createHash('sha256').update(contents).digest('hex')
        const utf16 = contents[0] === 0xff && contents[1] === 0xfe || contents[0] === 0xfe && contents[1] === 0xff
        if (!utf16 && contents.subarray(0, 8192).includes(0)) {
            throw new Error(this.translate.instant('This is a binary file. Use Download instead of editing.'))
        }
        if (!connected()) { throw new Error(this.translate.instant('Sync stopped: disconnected')) }
        const sameVersion = (a: SFTPFile, b: SFTPFile) => a.size === b.size && a.modified.getTime() === b.modified.getTime()
        if (!sameVersion(remoteVersion, await readVersion()) || await remoteHash() !== expectedHash) {
            throw new Error(this.translate.instant('Remote file changed while downloading. Open it again.'))
        }
        entry.openLocal = this.openLocalPath.bind(this, localPath)
        editor.controller = await RemoteFileEdit.start({
            localPath,
            upload: async snapshot => {
                await replaceRemoteFile({
                    upload: async (remotePath, data) => sftp.upload(remotePath, new SnapshotUpload(item.name, data, remoteVersion.mode)),
                    rename: (from, to) => sftp.rename(from, to),
                    unlink: remotePath => sftp.unlink(remotePath),
                    chmod: (remotePath, mode) => sftp.chmod(remotePath, mode),
                    verify: async () => {
                        if (!sameVersion(remoteVersion, await readVersion()) || await remoteHash() !== expectedHash) {
                            throw new Error(this.translate.instant('Remote file changed since opening. Local changes have been kept for comparison.'))
                        }
                    },
                }, target, snapshot, remoteVersion.mode)
                expectedHash = createHash('sha256').update(snapshot).digest('hex')
                remoteVersion = await readVersion()
            },
            onState: (state, error) => {
                const previous = entry.state
                this.files.update(entry, state, error)
                if (state === 'synced' && previous !== 'downloading' && previous !== 'synced') {
                    this.notifications.notice(this.translate.instant('Remote file synced: {name}', { name: item.name }))
                }
                if (state === 'error') {
                    this.notifications.error(this.translate.instant('Remote file sync failed: {name}', { name: item.name }), error)
                }
            },
        })
        if (!connected()) {
            editor.controller.stop()
            return
        }
        entry.retry = () => editor.controller!.flush()
        // Start monitoring before launching the editor so the first save is observed.
        try {
            await this.openLocalPath(localPath)
        } catch (error) {
            this.notifications.error(this.translate.instant('Could not open local editor'), String(error))
        }
    }
}
