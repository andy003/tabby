import { Component, ElementRef, HostBinding, Input, Output, EventEmitter } from '@angular/core'
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import { TranslateService } from '@ngx-translate/core'
import { FileTransfer, FileTransferState, PlatformService } from '../api/platform'
import { getTransferSummary, TransferSummary } from '../transferQueue'

interface TransferRow {
    transfer: FileTransfer
    path: string
    depth: number
}

/** @hidden */
@Component({
    selector: 'transfers-menu',
    templateUrl: './transfersMenu.component.pug',
    styleUrls: ['./transfersMenu.component.scss'],
})
export class TransfersMenuComponent {
    @Input() transfers: FileTransfer[] = []
    @Output() transfersChange = new EventEmitter<FileTransfer[]>()
    @Output() closed = new EventEmitter<void>()
    search = ''
    filter = 'all'
    @HostBinding('style.height.px') panelHeight = 240
    @HostBinding('class.resizing') resizing = false
    private resizeOrigin: { y: number, height: number } | null = null

    constructor (
        private platform: PlatformService,
        private translate: TranslateService,
        private element: ElementRef<HTMLElement>,
    ) { }

    startResize (event: PointerEvent): void {
        if (event.button !== 0) { return }
        event.preventDefault()
        this.resizeOrigin = { y: event.clientY, height: this.element.nativeElement.clientHeight }
        this.resizing = true
        const handle = event.currentTarget as HTMLElement
        handle.setPointerCapture(event.pointerId)
    }

    resize (event: PointerEvent): void {
        if (this.resizing && this.resizeOrigin) {
            this.resizeTo(this.resizeOrigin.height + this.resizeOrigin.y - event.clientY)
        }
    }

    stopResize (event: PointerEvent): void {
        this.resizing = false
        this.resizeOrigin = null
        const handle = event.currentTarget as HTMLElement
        if (handle.hasPointerCapture(event.pointerId)) { handle.releasePointerCapture(event.pointerId) }
    }

    resizeWithKeyboard (event: KeyboardEvent): void {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            this.resizeTo(this.element.nativeElement.clientHeight + (event.key === 'ArrowUp' ? 24 : -24))
        }
    }

    private resizeTo (height: number): void {
        const available = this.element.nativeElement.parentElement?.clientHeight ?? 400
        this.panelHeight = Math.round(Math.max(Math.min(190, available * .6), Math.min(available * .6, height)))
    }

    get summary (): TransferSummary { return getTransferSummary(this.transfers) }

    get hasActive (): boolean { return this.transfers.some(transfer => transfer.isActive()) }

    get hasFinished (): boolean { return this.transfers.some(transfer => !transfer.isActive()) }

    get rows (): TransferRow[] {
        const rows: TransferRow[] = []
        const visit = (transfer: FileTransfer, parent: string, depth: number) => {
            const name = transfer.relativePath || transfer.getName() || this.translate.instant('Upload files')
            const path = parent ? `${parent}/${name}` : name
            rows.push({ transfer, path, depth })
            transfer.getChildren().forEach(child => visit(child, path, depth + 1))
        }
        this.transfers.forEach(transfer => visit(transfer, '', 0))
        const query = this.search.trim().toLowerCase()
        return rows.filter(row => (!query || row.path.toLowerCase().includes(query)) &&
            (this.filter === 'all' || (this.filter === 'active' ? row.transfer.isActive() : row.transfer.getState() === this.filter)))
    }

    stateLabel (transfer: FileTransfer): string {
        const labels: Record<FileTransferState, string> = {
            queued: _('Queued'), running: _('Transferring'), completed: _('Succeeded'), failed: _('Failed'), cancelled: _('Cancelled'),
        }
        return labels[transfer.getState()]
    }

    getProgress (transfer: FileTransfer): number {
        if (transfer.isComplete()) { return 100 }
        const size = transfer.getSize()
        return size > 0 ? Math.max(0, Math.min(99, Math.round(100 * transfer.getCompletedBytes() / size))) : 0
    }

    showTransfer (transfer: FileTransfer): void {
        const filePath = transfer['filePath'] ?? transfer['basePath']
        if (filePath) { this.platform.showItemInFolder(filePath) }
    }

    clearFinished (): void {
        this.transfers = this.transfers.filter(transfer => transfer.isActive())
        this.transfersChange.emit(this.transfers)
    }

    async cancelAll (): Promise<void> {
        const result = await this.platform.showMessageBox({
            type: 'warning', message: this.translate.instant('There are active file transfers'),
            buttons: [this.translate.instant('Abort all'), this.translate.instant('Do not abort')], defaultId: 1, cancelId: 1,
        })
        if (result.response === 0) { this.transfers.forEach(transfer => transfer.cancel()) }
    }

    trackTransfer (_index: number, row: TransferRow): FileTransfer { return row.transfer }
}
