import * as C from 'constants'
import { posix as path } from 'path'
import { Component, Input, Output, EventEmitter, Inject, Optional } from '@angular/core'
import { FileUpload, FileTransfer, TransferJob, TransferTask, runTransferJobs, getTransferSummary, failTransferTree, DirectoryUpload, DirectoryDownload, FileSyncEntry, FileSyncService, MenuItemOptions, NotificationsService, PlatformService, TranslateService } from 'tabby-core'
import { SFTPSession, SFTPFile } from '../session/sftp'
import { SSHSession } from '../session/ssh'
import { SFTPContextMenuItemProvider } from '../api'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { SFTPCreateDirectoryModalComponent } from './sftpCreateDirectoryModal.component'

@Component({
    selector: 'sftp-panel',
    templateUrl: './sftpPanel.component.pug',
    styleUrls: ['./sftpPanel.component.scss'],
})
export class SFTPPanelComponent {
    @Input() session: SSHSession
    @Output() closed = new EventEmitter<void>()
    sftp: SFTPSession
    fileList: SFTPFile[]|null = null
    filteredFileList: SFTPFile[] = []
    @Input() path = '/'
    @Output() pathChange = new EventEmitter<string>()
    @Input() cwdDetectionAvailable = false
    editingPath: string|null = null
    showFilter = false
    filterText = ''
    connectionError: string|null = null
    selectedFile: SFTPFile|null = null

    constructor (
        private ngbModal: NgbModal,
        private notifications: NotificationsService,
        public platform: PlatformService,
        public fileSync: FileSyncService,
        private translate: TranslateService,
        @Optional() @Inject(SFTPContextMenuItemProvider) protected contextMenuProviders: SFTPContextMenuItemProvider[],
    ) {
        this.contextMenuProviders.sort((a, b) => a.weight - b.weight)
    }

    async ngOnInit (): Promise<void> {
        this.connectionError = null
        try {
            this.sftp = await this.session.openSFTP()
        } catch (error) {
            this.connectionError = error instanceof Error ? error.message : String(error)
            this.notifications.error(this.connectionError)
            return
        }
        await this.navigate(this.path)
    }

    async navigate (newPath: string, fallbackOnError = true): Promise<void> {
        const previousPath = this.path
        this.path = newPath
        this.selectedFile = null
        this.editingPath = null
        this.pathChange.next(this.path)

        this.clearFilter()

        this.fileList = null
        this.filteredFileList = []
        try {
            this.fileList = await this.sftp.readdir(this.path)
        } catch (error) {
            this.notifications.error(error.message)
            if (previousPath && fallbackOnError) {
                await this.navigate(previousPath, false)
            }
            return
        }

        const dirKey = a => a.isDirectory ? 1 : 0
        this.fileList.sort((a, b) =>
            dirKey(b) - dirKey(a) ||
            a.name.localeCompare(b.name))

        this.updateFilteredList()
    }

    getFileType (fileExtension: string): string {
        const codeExtensions = ['js', 'ts', 'py', 'java', 'cpp', 'h', 'cs', 'html', 'css', 'rb', 'php', 'swift', 'go', 'kt', 'sh', 'json', 'cc', 'c', 'xml']
        const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp']
        const pdfExtensions = ['pdf']
        const archiveExtensions = ['zip', 'rar', 'tar', 'gz']
        const wordExtensions = ['doc', 'docx']
        const videoExtensions = ['mp4', 'avi', 'mkv', 'mov']
        const powerpointExtensions = ['ppt', 'pptx']
        const textExtensions = ['txt', 'log']
        const audioExtensions = ['mp3', 'wav', 'flac']
        const excelExtensions = ['xls', 'xlsx']

        const lowerCaseExtension = fileExtension.toLowerCase()

        if (codeExtensions.includes(lowerCaseExtension)) {
            return 'code'
        } else if (imageExtensions.includes(lowerCaseExtension)) {
            return 'image'
        } else if (pdfExtensions.includes(lowerCaseExtension)) {
            return 'pdf'
        } else if (archiveExtensions.includes(lowerCaseExtension)) {
            return 'archive'
        } else if (wordExtensions.includes(lowerCaseExtension)) {
            return 'word'
        } else if (videoExtensions.includes(lowerCaseExtension)) {
            return 'video'
        } else if (powerpointExtensions.includes(lowerCaseExtension)) {
            return 'powerpoint'
        } else if (textExtensions.includes(lowerCaseExtension)) {
            return 'text'
        } else if (audioExtensions.includes(lowerCaseExtension)) {
            return 'audio'
        } else if (excelExtensions.includes(lowerCaseExtension)) {
            return 'excel'
        } else {
            return 'unknown'
        }
    }

    getIcon (item: SFTPFile): string {
        if (item.isDirectory) {
            return 'fas fa-folder text-info'
        }
        if (item.isSymlink) {
            return 'fas fa-link text-warning'
        }
        const fileMatch = /\.([^.]+)$/.exec(item.name)
        const extension = fileMatch ? fileMatch[1] : null
        if (extension !== null) {
            const fileType = this.getFileType(extension)

            switch (fileType) {
                case 'unknown':
                    return 'fas fa-file'
                default:
                    return `fa-solid fa-file-${fileType} `
            }
        }
        return 'fas fa-file'
    }

    goUp (): void {
        this.navigate(path.dirname(this.path))
    }

    async open (item: SFTPFile): Promise<void> {
        this.selectedFile = item
        if (item.isDirectory) {
            await this.navigate(item.fullPath)
        } else if (item.isSymlink) {
            const target = path.resolve(this.path, await this.sftp.readlink(item.fullPath))
            const stat = await this.sftp.stat(target)
            if (stat.isDirectory) {
                await this.navigate(item.fullPath)
            } else {
                await this.edit(item)
            }
        } else {
            await this.edit(item)
        }
    }

    async edit (item: SFTPFile): Promise<void> {
        this.selectedFile = item
        try {
            for (const provider of this.contextMenuProviders) {
                if (await provider.editFile(item, this)) { return }
            }
            await this.downloadItem(item)
        } catch (error) {
            this.notifications.error(this.translate.instant('Could not open remote file'), String(error))
        }
    }

    syncFor (item: SFTPFile): FileSyncEntry|undefined {
        return this.fileSync.find(this.session, item.fullPath)
    }

    get canEditFiles (): boolean {
        return this.contextMenuProviders.some(provider => provider.supportsEditing)
    }

    async retrySync (entry: FileSyncEntry): Promise<void> {
        try {
            await entry.retry?.()
        } catch (error) {
            this.fileSync.update(entry, 'error', String(error))
        }
    }

    async downloadItem (item: SFTPFile): Promise<void> {
        if (item.isDirectory) {
            await this.downloadFolder(item)
            return
        }

        if (item.isSymlink) {
            const target = path.resolve(this.path, await this.sftp.readlink(item.fullPath))
            const stat = await this.sftp.stat(target)
            if (stat.isDirectory) {
                await this.downloadFolder(item)
                return
            }
            await this.download(item.fullPath, stat.mode, stat.size)
            return
        }

        await this.download(item.fullPath, item.mode, item.size)
    }

    async openCreateDirectoryModal (): Promise<void> {
        const modal = this.ngbModal.open(SFTPCreateDirectoryModalComponent)
        const directoryName = await modal.result.catch(() => null)
        if (directoryName?.trim()) {
            this.sftp.mkdir(path.join(this.path, directoryName)).then(() => {
                this.notifications.notice('The directory was created successfully')
                this.navigate(path.join(this.path, directoryName))
            }).catch(() => {
                this.notifications.error('The directory could not be created')
            })
        }
    }

    async upload (): Promise<void> {
        const destination = this.path
        const transfers = await this.platform.startUpload({ multiple: true })
        if (!transfers.length) { return }
        await runTransferJobs(transfers.map(transfer => ({ transfer, run: () => this.sftp.upload(path.join(destination, transfer.getName()), transfer) })))
        this.reportTransfers(transfers)
        if (this.path === destination) { await this.navigate(destination) }
    }

    async uploadFolder (): Promise<void> {
        const destination = this.path
        const transfer = await this.platform.startUploadDirectory()
        if (!transfer.getName() && !transfer.getChildren().length) { return }
        await this.uploadOneFolder(transfer, destination)
    }

    async uploadOneFolder (transfer: DirectoryUpload, destination = this.path): Promise<void> {
        try {
            await this.uploadDirectory(transfer, path.join(destination, transfer.getName()))
        } catch (error) {
            failTransferTree(transfer, error instanceof Error ? error.message : String(error))
        }
        this.reportTransfers([transfer])
        if (this.path === destination) { await this.navigate(destination) }
    }

    private async uploadDirectory (transfer: DirectoryUpload, destination: string): Promise<void> {
        if (!transfer.isActive()) { return }
        transfer.setStarted()
        if (transfer.getName()) {
            try {
                await this.sftp.mkdir(destination)
            } catch (error) {
                const existing = await this.sftp.stat(destination).catch(() => null)
                if (!existing?.isDirectory) {
                    failTransferTree(transfer, error instanceof Error ? error.message : String(error))
                    return
                }
            }
        }
        for (const child of transfer.getChildrens()) {
            if (transfer.isCancelled()) { child.cancel() }
            if (child instanceof DirectoryUpload) {
                await this.uploadDirectory(child, path.join(destination, child.getName()))
            } else {
                await runTransferJobs([{ transfer: child, run: () => this.sftp.upload(path.join(destination, child.getName()), child) }])
            }
        }
        this.finishGroup(transfer)
    }

    async uploadOne (transfer: FileUpload): Promise<void> {
        const destination = this.path
        await runTransferJobs([{ transfer, run: () => this.sftp.upload(path.join(destination, transfer.getName()), transfer) }])
        this.reportTransfers([transfer])
        if (this.path === destination) { await this.navigate(destination) }
    }

    async download (itemPath: string, mode: number, size: number): Promise<void> {
        const transfer = await this.platform.startDownload(path.basename(itemPath), mode, size)
        if (!transfer) { return }
        await runTransferJobs([{ transfer, run: () => this.sftp.download(itemPath, transfer) }])
        this.reportTransfers([transfer])
    }

    async downloadFolder (folder: SFTPFile): Promise<void> {
        try {
            const transfer = await this.platform.startDownloadDirectory(folder.name, 0)
            if (!transfer) { return }
            try {
                if (!transfer.isCancelled()) {
                    const jobs: TransferJob[] = []
                    transfer.setStatus(this.translate.instant('Preparing file list'))
                    await this.planDirectoryDownload(folder, transfer, '', jobs)
                    transfer.setStatus('')
                    if (transfer.isFailed()) {
                        transfer.getChildren().forEach(child => failTransferTree(child, transfer.getError()))
                    } else {
                        transfer.setStarted()
                        await runTransferJobs(jobs, () => transfer.isCancelled())
                    }
                    this.finishGroup(transfer)
                }
                this.reportTransfers([transfer])
            } catch (error) {
                failTransferTree(transfer, error instanceof Error ? error.message : String(error))
                this.reportTransfers([transfer])
            } finally {
                transfer.close()
            }
        } catch (error) {
            this.notifications.error(this.translate.instant('Could not start directory download'), String(error))
        }
    }

    private async planDirectoryDownload (folder: SFTPFile, transfer: DirectoryDownload, relativePath: string, jobs: TransferJob[], directoryTask: FileTransfer = transfer): Promise<void> {
        if (transfer.isCancelled()) { return }
        let items: SFTPFile[] = []
        try {
            items = await this.sftp.readdir(folder.fullPath)
        } catch (error) {
            directoryTask.setFailed(error instanceof Error ? error.message : String(error))
            return
        }
        for (const item of items) {
            if (transfer.isCancelled()) { return }
            const itemPath = path.join(relativePath, item.name)
            if (item.isDirectory) {
                const directory = new TransferTask(item.name, 0, 'download', true)
                directoryTask.addChild(directory)
                jobs.push({ transfer: directory, run: async () => {
                    try {
                        await transfer.createDirectory(itemPath)
                    } catch (error) {
                        failTransferTree(directory, error instanceof Error ? error.message : String(error))
                        throw error
                    }
                } })
                await this.planDirectoryDownload(item, transfer, itemPath, jobs, directory)
            } else {
                try {
                    const file = await transfer.createFile(itemPath, item.mode, item.size)
                    file.relativePath = ''
                    if (directoryTask !== transfer) {
                        const index = transfer.getChildren().indexOf(file)
                        if (index >= 0) { transfer.getChildren().splice(index, 1) }
                        directoryTask.addChild(file)
                    }
                    jobs.push({ transfer: file, run: () => this.sftp.download(item.fullPath, file) })
                } catch (error) {
                    const failed = new TransferTask(item.name, item.size, 'download')
                    failed.setFailed(error instanceof Error ? error.message : String(error))
                    directoryTask.addChild(failed)
                }
            }
        }
    }

    private finishGroup (transfer: FileTransfer): void {
        if (!transfer.isActive()) { return }
        transfer.getChildren().filter(child => child.getChildren().length > 0).forEach(child => this.finishGroup(child))
        const result = getTransferSummary([transfer])
        if (result.failed || result.cancelled) {
            transfer.setFailed(this.translate.instant('Some items did not complete. See the file list for details.'))
        } else {
            transfer.setCompleted(true)
        }
    }

    private reportTransfers (transfers: FileTransfer[]): void {
        const result = getTransferSummary(transfers)
        const message = this.translate.instant('Transfers finished: {success} succeeded, {failed} failed, {cancelled} cancelled.', {
            success: result.completed, failed: result.failed, cancelled: result.cancelled,
        })
        if (result.failed) { this.notifications.error(message) } else { this.notifications.info(message) }
    }

    getModeString (item: SFTPFile): string {
        const s = 'SGdrwxrwxrwx'
        const e = '   ---------'
        const c = [
            0o4000, 0o2000, C.S_IFDIR,
            C.S_IRUSR, C.S_IWUSR, C.S_IXUSR,
            C.S_IRGRP, C.S_IWGRP, C.S_IXGRP,
            C.S_IROTH, C.S_IWOTH, C.S_IXOTH,
        ]
        let result = ''
        for (let i = 0; i < c.length; i++) {
            result += item.mode & c[i] ? s[i] : e[i]
        }
        return result
    }

    async buildContextMenu (item: SFTPFile): Promise<MenuItemOptions[]> {
        let items: MenuItemOptions[] = []
        for (const section of await Promise.all(this.contextMenuProviders.map(x => x.getItems(item, this)))) {
            items.push({ type: 'separator' })
            items = items.concat(section)
        }
        return items.slice(1)
    }

    async showContextMenu (item: SFTPFile, event: MouseEvent): Promise<void> {
        event.preventDefault()
        this.platform.popupContextMenu(await this.buildContextMenu(item), event)
    }

    get shouldShowCWDTip (): boolean {
        return !window.localStorage.sshCWDTipDismissed
    }

    dismissCWDTip (): void {
        window.localStorage.sshCWDTipDismissed = 'true'
    }

    async confirmPath (): Promise<void> {
        const newPath = this.editingPath ?? this.path
        if (!newPath.trim()) {
            this.editingPath = null
            return
        }
        await this.navigate(path.resolve(this.path, newPath))
    }

    close (): void {
        this.closed.emit()
    }

    clearFilter (): void {
        this.showFilter = false
        this.filterText = ''
        this.updateFilteredList()
    }

    onFilterChange (): void {
        this.updateFilteredList()
    }

    private updateFilteredList (): void {
        if (!this.fileList) {
            this.filteredFileList = []
            return
        }

        if (!this.showFilter || this.filterText.trim() === '') {
            this.filteredFileList = this.fileList
            return
        }

        this.filteredFileList = this.fileList.filter(item =>
            item.name.toLowerCase().includes(this.filterText.toLowerCase()),
        )
    }
}
