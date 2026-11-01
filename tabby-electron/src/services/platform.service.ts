import * as path from 'path'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as os from 'os'
import promiseIpc, { RendererProcessType } from 'electron-promise-ipc'
import { execFile } from 'mz/child_process'
import { Injectable, NgZone } from '@angular/core'
import { PlatformService, ClipboardContent, Platform, MenuItemOptions, MessageBoxOptions, MessageBoxResult, DirectoryUpload, FileUpload, FileDownload, DirectoryDownload, FileUploadOptions, wrapPromise, TranslateService, FileTransfer, PlatformTheme } from 'tabby-core'
import { ElectronService } from '../services/electron.service'
import { ElectronHostWindow } from './hostWindow.service'
import { ShellIntegrationService } from './shellIntegration.service'
import { ElectronHostAppService } from './hostApp.service'
import { configPath } from '../../../app/lib/config'
const fontManager = require('fontmanager-redux') // eslint-disable-line

/* eslint-disable block-scoped-var */

try {
    // eslint-disable-next-line no-var
    var windowsProcessTreeNative = require('@tabby-gang/windows-process-tree/build/Release/windows_process_tree.node')
    // eslint-disable-next-line no-var
    var wnr = require('windows-native-registry')
} catch { }

/**
 * Resolve `relativePath` against `basePath` and ensure the result stays inside `basePath`.
 */
export function resolveInsideBase (basePath: string, relativePath: string): string {
    const base = path.resolve(basePath)
    const target = path.resolve(base, relativePath)
    const rel = path.relative(base, target)
    if (rel !== '' && (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel))) {
        throw new Error(`Refusing access outside the target directory: ${relativePath}`)
    }
    return target
}

@Injectable({ providedIn: 'root' })
export class ElectronPlatformService extends PlatformService {
    supportsWindowControls = true
    private safeExternalSchemes = new Set(['http', 'https', 'ftp', 'mailto'])
    private configPath: string

    constructor (
        private hostApp: ElectronHostAppService,
        private hostWindow: ElectronHostWindow,
        private electron: ElectronService,
        private zone: NgZone,
        private shellIntegration: ShellIntegrationService,
        private translate: TranslateService,
    ) {
        super()
        this.configPath = configPath

        electron.ipcRenderer.on('host:display-metrics-changed', () => {
            this.zone.run(() => this.displayMetricsChanged.next())
        })

        electron.nativeTheme.on('updated', () => {
            this.zone.run(() => this.themeChanged.next(this.getTheme()))
        })
    }

    async getAllFiles (dir: string, root: DirectoryUpload): Promise<DirectoryUpload> {
        let items: fsSync.Dirent[] = []
        try {
            items = await fs.readdir(dir, { withFileTypes: true })
        } catch (error) {
            root.setFailed(error instanceof Error ? error.message : String(error))
            return root
        }
        for (const item of items) {
            if (root.isCancelled()) { break }
            if (item.isDirectory()) {
                const child = new DirectoryUpload(item.name)
                root.pushChildren(child)
                await this.getAllFiles(path.join(dir, item.name), child)
            } else {
                const file = new ElectronFileUpload(path.join(dir, item.name), this.electron)
                root.pushChildren(file)
                try {
                    await wrapPromise(this.zone, file.open())
                } catch (error) {
                    file.setFailed(error instanceof Error ? error.message : String(error))
                }
            }
        }
        return root
    }

    readClipboard (): string {
        return this.electron.clipboard.readText()
    }

    setClipboard (content: ClipboardContent): void {
        require('@electron/remote').clipboard.write(content)
    }

    async installPlugin (name: string, version: string): Promise<void> {
        await (promiseIpc as RendererProcessType).send('plugin-manager:install', name, version)
    }

    async uninstallPlugin (name: string): Promise<void> {
        await (promiseIpc as RendererProcessType).send('plugin-manager:uninstall', name)
    }

    async isProcessRunning (name: string): Promise<boolean> {
        if (this.hostApp.platform === Platform.Windows) {
            return new Promise<boolean>(resolve => {
                windowsProcessTreeNative.getProcessList(list => { // eslint-disable-line block-scoped-var
                    resolve(list.some(x => x.name === name))
                }, 0)
            })
        } else {
            throw new Error('Not supported')
        }
    }

    getWinSCPPath (): string|null {
        const key = wnr.getRegistryKey(wnr.HK.CR, 'WinSCP.Url\\DefaultIcon')
        if (key?.['']) {
            let detectedPath = key[''].value?.split(',')[0]
            detectedPath = detectedPath?.substring(1, detectedPath.length - 1)
            return detectedPath
        }
        return null
    }

    async exec (app: string, argv: string[]): Promise<void> {
        await execFile(app, argv)
    }

    isShellIntegrationSupported (): boolean {
        return this.hostApp.platform !== Platform.Linux
    }

    async isShellIntegrationInstalled (): Promise<boolean> {
        return this.shellIntegration.isInstalled()
    }

    async installShellIntegration (): Promise<void> {
        await this.shellIntegration.install()
    }

    async uninstallShellIntegration (): Promise<void> {
        await this.shellIntegration.remove()
    }

    async loadConfig (): Promise<string> {
        if (fsSync.existsSync(this.configPath)) {
            return fs.readFile(this.configPath, 'utf8')
        } else {
            return ''
        }
    }

    async saveConfig (content: string): Promise<void> {
        await this.hostApp.saveConfig(content)
    }

    getConfigPath (): string|null {
        return this.configPath
    }

    showItemInFolder (p: string): void {
        this.electron.shell.showItemInFolder(p)
    }

    async openExternal (url: string): Promise<void> {
        const scheme = this.getExternalScheme(url)
        if (scheme && this.safeExternalSchemes.has(scheme)) {
            await this.electron.shell.openExternal(url)
        } else {
            await this.confirmAndOpenExternal(url)
        }
    }

    private getExternalScheme (url: string): string | null {
        try {
            const protocol = new URL(url.trim()).protocol
            return protocol ? protocol.replace(':', '').toLowerCase() : null
        } catch {
            return null
        }
    }

    private async confirmAndOpenExternal (url: string): Promise<void> {
        const scheme = this.getExternalScheme(url)
        const result = await this.electron.dialog.showMessageBox(
            this.hostWindow.getWindow(),
            {
                type: 'warning',
                message: this.translate.instant(`Open this app-specific "${scheme}" URI?`),
                detail: url,
                buttons: [
                    this.translate.instant('Open'),
                    this.translate.instant('Cancel'),
                ],
                defaultId: 0,
                cancelId: 1,
            },
        )

        if (result.response === 0) {
            await this.electron.shell.openExternal(url)
        }
    }

    openPath (p: string): void {
        this.electron.shell.openPath(p)
    }

    getOSRelease (): string {
        return os.release()
    }

    getAppVersion (): string {
        return this.electron.app.getVersion()
    }

    async listFonts (): Promise<string[]> {
        if (this.hostApp.platform === Platform.Windows || this.hostApp.platform === Platform.macOS) {
            let fonts = await new Promise<any[]>(resolve => fontManager.getAvailableFonts(resolve))
            fonts = fonts.map(x => x.family.trim())
            return fonts
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (this.hostApp.platform === Platform.Linux) {
            const stdout = (await execFile('fc-list', [':spacing=mono']))[0]
            const fonts = stdout.toString()
                .split('\n')
                .filter(x => !!x)
                .map(x => x.split(':')[1].trim())
                .map(x => x.split(',')[0].trim())
            fonts.sort()
            return fonts
        }
        return []
    }

    popupContextMenu (menu: MenuItemOptions[], _event?: MouseEvent): void {
        this.electron.Menu.buildFromTemplate(menu.map(item => this.rewrapMenuItemOptions(item))).popup({})
    }

    rewrapMenuItemOptions (menu: MenuItemOptions): MenuItemOptions {
        return {
            ...menu,
            click: () => {
                this.zone.run(() => {
                    menu.click?.()
                })
            },
            submenu: menu.submenu ? menu.submenu.map(x => this.rewrapMenuItemOptions(x)) : undefined,
        }
    }

    async showMessageBox (options: MessageBoxOptions): Promise<MessageBoxResult> {
        return this.electron.dialog.showMessageBox(this.hostWindow.getWindow(), options)
    }

    quit (): void {
        this.electron.app.exit(0)
    }

    async startUpload (options?: FileUploadOptions, paths?: string[]): Promise<FileUpload[]> {
        options ??= { multiple: false }

        const properties: any[] = ['openFile', 'treatPackageAsDirectory']
        if (options.multiple) {
            properties.push('multiSelections')
        }

        if (!paths) {
            const result = await this.electron.dialog.showOpenDialog(
                this.hostWindow.getWindow(),
                {
                    buttonLabel: this.translate.instant('Select'),
                    properties,
                },
            )
            if (result.canceled) {
                return []
            }
            paths = result.filePaths
        }

        return Promise.all(paths.map(async p => {
            const transfer = new ElectronFileUpload(p, this.electron)
            this.fileTransferStarted.next(transfer)
            try {
                await wrapPromise(this.zone, transfer.open())
            } catch (error) {
                transfer.setFailed(error instanceof Error ? error.message : String(error))
            }
            return transfer
        }))
    }

    async startUploadDirectory (paths?: string[]): Promise<DirectoryUpload> {
        const properties: any[] = ['openFile', 'treatPackageAsDirectory', 'openDirectory']

        if (!paths) {
            const result = await this.electron.dialog.showOpenDialog(
                this.hostWindow.getWindow(),
                {
                    buttonLabel: this.translate.instant('Select'),
                    properties,
                },
            )
            if (result.canceled) {
                return new DirectoryUpload()
            }
            paths = result.filePaths
        }

        if (!paths.length) { return new DirectoryUpload() }
        const root = new DirectoryUpload(path.basename(paths[0]))
        root.setStatus(this.translate.instant('Preparing file list'))
        this.fileTransferStarted.next(root)
        await this.getAllFiles(paths[0], root)
        root.setStatus('')
        return root
    }

    async startDownload (name: string, mode: number, size: number, filePath?: string, options: { showInTransfers?: boolean } = {}): Promise<FileDownload|null> {
        if (!filePath) {
            const result = await this.electron.dialog.showSaveDialog(
                this.hostWindow.getWindow(),
                {
                    defaultPath: name,
                },
            )
            if (!result.filePath) {
                return null
            }
            filePath = result.filePath
        }
        const transfer = new ElectronFileDownload(filePath, mode, size, this.electron)
        await wrapPromise(this.zone, transfer.open())
        if (options.showInTransfers !== false) { this.fileTransferStarted.next(transfer) }
        return transfer
    }

    async startDownloadDirectory (name: string, estimatedSize?: number): Promise<DirectoryDownload|null> {
        const selectedFolder = await this.pickDirectory(this.translate.instant('Select destination folder for {name}', { name }), this.translate.instant('Download here'))
        if (!selectedFolder) {
            return null
        }

        let downloadPath = resolveInsideBase(selectedFolder, name)
        let counter = 1
        while (fsSync.existsSync(downloadPath)) {
            downloadPath = resolveInsideBase(selectedFolder, `${name} (${counter})`)
            counter++
        }

        const transfer = new ElectronDirectoryDownload(downloadPath, name, estimatedSize ?? 0, this.electron)
        this.fileTransferStarted.next(transfer)
        try {
            await wrapPromise(this.zone, transfer.open())
        } catch (error) {
            transfer.setFailed(error instanceof Error ? error.message : String(error))
        }
        return transfer
    }

    _registerFileTransfer (transfer: FileTransfer): void {
        this.fileTransferStarted.next(transfer)
    }

    setErrorHandler (handler: (_: any) => void): void {
        this.electron.ipcRenderer.on('uncaughtException', (_$event, err) => {
            handler(err)
        })
    }

    async pickDirectory (title?: string, buttonLabel?: string): Promise<string | null> {
        const result = await this.electron.dialog.showOpenDialog(
            this.hostWindow.getWindow(),
            {
                title,
                buttonLabel,
                properties: ['openDirectory', 'showHiddenFiles'],
            },
        )
        if (result.canceled || !result.filePaths.length) {
            return null
        }
        return result.filePaths[0]
    }

    async pickApplication (): Promise<string|null> {
        const result = await this.electron.dialog.showOpenDialog(this.hostWindow.getWindow(), {
            title: this.translate.instant('Select text editor'),
            properties: ['openFile'],
            filters: [{
                name: this.translate.instant('Applications'),
                extensions: process.platform === 'win32' ? ['exe'] : process.platform === 'darwin' ? ['app', '*'] : ['*'],
            }],
        })
        return result.canceled ? null : result.filePaths[0] ?? null
    }

    getTheme (): PlatformTheme {
        if (this.electron.nativeTheme.shouldUseDarkColors) {
            return 'dark'
        } else {
            return 'light'
        }
    }
}

class ElectronFileUpload extends FileUpload {
    private size = 0
    private mode = 0o644
    private file: fs.FileHandle|undefined
    private buffer = new Uint8Array(256 * 1024)
    private powerSaveBlocker: number|null = null
    private closing: Promise<void>|undefined

    constructor (private filePath: string, private electron: ElectronService) { super() }

    async open (): Promise<void> {
        const stat = await fs.stat(this.filePath)
        this.size = stat.size
        this.mode = stat.mode
        this.setTotalSize(this.size)
    }

    getName (): string { return path.basename(this.filePath) }

    getMode (): number { return this.mode }

    getSize (): number { return this.size }

    async read (): Promise<Uint8Array> {
        if (this.isCancelled()) { throw new Error('Transfer cancelled') }
        if (!this.file) {
            this.file = await fs.open(this.filePath, 'r')
            this.powerSaveBlocker = this.electron.powerSaveBlocker.start('prevent-app-suspension')
            if (this.isCancelled()) { this.close(); throw new Error('Transfer cancelled') }
        }
        const result = await this.file.read(this.buffer, 0, this.buffer.length, null)
        this.increaseProgress(result.bytesRead)
        return this.buffer.slice(0, result.bytesRead)
    }

    async finalize (): Promise<void> {
        this.close()
        await this.closing
    }

    close (): void {
        if (this.powerSaveBlocker !== null) { this.electron.powerSaveBlocker.stop(this.powerSaveBlocker); this.powerSaveBlocker = null }
        if (this.file && !this.closing) {
            this.closing = this.file.close()
            this.closing.catch(() => null)
        }
    }
}

class ElectronFileDownload extends FileDownload {
    private file: fs.FileHandle|undefined
    private opening: Promise<fs.FileHandle>|undefined
    private closing: Promise<void>|undefined
    private powerSaveBlocker: number|null = null

    constructor (
        private filePath: string,
        private mode: number,
        private size: number,
        private electron: ElectronService,
    ) {
        super()
        this.setTotalSize(size)
    }

    async open (): Promise<void> { /* Files are opened when their queued transfer starts. */ }

    getName (): string { return path.basename(this.filePath) }

    getSize (): number { return this.size }

    private async ensureFile (): Promise<fs.FileHandle> {
        if (this.isCancelled()) { throw new Error('Transfer cancelled') }
        if (!this.opening) {
            this.opening = (async () => {
                await fs.mkdir(path.dirname(this.filePath), { recursive: true })
                const file = await fs.open(this.filePath, 'w', this.mode)
                this.file = file
                this.powerSaveBlocker = this.electron.powerSaveBlocker.start('prevent-app-suspension')
                return file
            })()
        }
        const file = await this.opening
        if (this.isCancelled()) { this.close(); throw new Error('Transfer cancelled') }
        return file
    }

    async write (buffer: Uint8Array): Promise<void> {
        const file = await this.ensureFile()
        let pos = 0
        while (pos < buffer.length) {
            const result = await file.write(buffer, pos, buffer.length - pos, null)
            this.increaseProgress(result.bytesWritten)
            pos += result.bytesWritten
        }
    }

    async finalize (): Promise<void> {
        await this.ensureFile()
        this.close()
        await this.closing
    }

    close (): void {
        if (this.powerSaveBlocker !== null) { this.electron.powerSaveBlocker.stop(this.powerSaveBlocker); this.powerSaveBlocker = null }
        if (this.file && !this.closing) {
            this.closing = this.file.close()
            this.closing.catch(() => null)
        }
    }
}

class ElectronDirectoryDownload extends DirectoryDownload {
    private powerSaveBlocker: number|null = null

    constructor (
        private basePath: string,
        private name: string,
        estimatedSize: number,
        private electron: ElectronService,
    ) {
        super()
        this.setTotalSize(estimatedSize)
    }

    async open (): Promise<void> {
        await fs.mkdir(this.basePath, { recursive: true })
        this.powerSaveBlocker = this.electron.powerSaveBlocker.start('prevent-app-suspension')
    }

    getName (): string { return this.name }

    getSize (): number { return this.getTotalSize() }

    async createDirectory (relativePath: string): Promise<void> {
        const fullPath = resolveInsideBase(this.basePath, relativePath)
        await fs.mkdir(fullPath, { recursive: true })
    }

    async createFile (relativePath: string, mode: number, size: number): Promise<FileDownload> {
        const fullPath = resolveInsideBase(this.basePath, relativePath)
        const fileDownload = new ElectronFileDownload(fullPath, mode, size, this.electron)
        fileDownload.relativePath = relativePath
        this.addChild(fileDownload)
        return fileDownload
    }

    close (): void {
        if (this.powerSaveBlocker !== null) { this.electron.powerSaveBlocker.stop(this.powerSaveBlocker); this.powerSaveBlocker = null }
    }
}
