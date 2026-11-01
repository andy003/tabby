import { Injectable } from '@angular/core'
import { Command, CommandContext, CommandProvider, HostAppService, NotificationsService, Platform, TranslateService } from 'tabby-core'
import { SSHTabComponent } from './components/sshTab.component'

/** @hidden */
@Injectable()
export class SSHCommandProvider extends CommandProvider {
    constructor (
        private hostApp: HostAppService,
        private notifications: NotificationsService,
        private translate: TranslateService,
    ) { super() }

    async provide (context: CommandContext): Promise<Command[]> {
        const tab = context.tab
        if (!(tab instanceof SSHTabComponent)) { return [] }
        const connected = (): boolean => {
            if (tab.sshSession?.open) { return true }
            this.notifications.notice(this.translate.instant('Connect to an SSH server first'))
            return false
        }
        const commands: Command[] = [{
            id: 'ssh:sftp', label: this.translate.instant('SFTP'),
            get checked (): boolean { return tab.sftpPanelVisible },
            run: async () => { if (tab.sftpPanelVisible) { tab.sftpPanelVisible = false } else if (connected()) { await tab.openSFTP() } },
        }]
        if (this.hostApp.platform !== Platform.Web) {
            commands.push({
                id: 'ssh:tunnels', label: this.translate.instant('SSH tunnels'),
                run: async () => { if (connected()) { tab.showPortForwarding() } },
            })
        }
        return commands
    }
}
