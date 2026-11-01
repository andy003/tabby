import { promises as fs } from 'fs'
import { Injectable } from '@angular/core'
import { FileProvider, TranslateService } from 'tabby-core'
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import { ElectronService } from '../services/electron.service'
import { ElectronHostWindow } from './hostWindow.service'

@Injectable()
export class ElectronFileProvider extends FileProvider {
    name = _('Filesystem')

    constructor (
        private electron: ElectronService,
        private hostWindow: ElectronHostWindow,
        private translate: TranslateService,
    ) {
        super()
    }

    async selectAndStoreFile (description: string): Promise<string> {
        const result = await this.electron.dialog.showOpenDialog(
            this.hostWindow.getWindow(),
            {
                buttonLabel: this.translate.instant('Select {description}', { description }),
                properties: ['openFile', 'treatPackageAsDirectory'],
            },
        )
        if (result.canceled || !result.filePaths.length) {
            throw new Error('canceled')
        }

        return `file://${result.filePaths[0]}`
    }

    async retrieveFile (key: string): Promise<Buffer> {
        if (key.startsWith('file://')) {
            key = key.substring('file://'.length)
        } else if (key.includes('://')) {
            throw new Error('Incorrect type')
        }
        return fs.readFile(key, { encoding: null })
    }
}
