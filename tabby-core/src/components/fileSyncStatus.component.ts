import { Component } from '@angular/core'
import { FileSyncEntry, FileSyncService } from '../services/fileSync.service'
import { NotificationsService } from '../services/notifications.service'
import { TranslateService } from '@ngx-translate/core'

/** @hidden */
@Component({
    selector: 'file-sync-status',
    templateUrl: './fileSyncStatus.component.pug',
    styleUrls: ['./fileSyncStatus.component.scss'],
})
export class FileSyncStatusComponent {
    constructor (
        public files: FileSyncService,
        private notifications: NotificationsService,
        private translate: TranslateService,
    ) { }

    async retry (entry: FileSyncEntry): Promise<void> {
        try {
            await entry.retry?.()
        } catch (error) {
            this.files.update(entry, 'error', String(error))
        }
    }

    async openLocal (entry: FileSyncEntry): Promise<void> {
        try {
            await entry.openLocal?.()
        } catch (error) {
            this.notifications.error(this.translate.instant('Could not open local editor'), String(error))
        }
    }
}
