import { Component, HostBinding } from '@angular/core'
import { X11Socket } from '../session/x11'
import { ConfigService, HostAppService, NotificationsService, Platform, PlatformService, TranslateService } from 'tabby-core'

/** @hidden */
@Component({
    templateUrl: './sshSettingsTab.component.pug',
})
export class SSHSettingsTabComponent {
    Platform = Platform
    defaultX11Display: string

    @HostBinding('class.content-box') true

    constructor (
        public config: ConfigService,
        public hostApp: HostAppService,
        private platform: PlatformService,
        private notifications: NotificationsService,
        private translate: TranslateService,
    ) {
        const spec = X11Socket.resolveDisplaySpec()
        if ('path' in spec) {
            this.defaultX11Display = spec.path
        } else {
            this.defaultX11Display = `${spec.host}:${spec.port}`
        }
    }

    async pickEditor (): Promise<void> {
        try {
            const selected = await this.platform.pickApplication()
            if (!selected) { return }
            this.config.store.ssh.fileEditorPath = selected
            await this.config.save()
        } catch (error) {
            this.notifications.error(this.translate.instant('Could not save editor settings'), String(error))
        }
    }
}
