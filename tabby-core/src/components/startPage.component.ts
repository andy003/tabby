import { Component } from '@angular/core'
import { HomeBaseService } from '../services/homeBase.service'
import { CommandService } from '../services/commands.service'
import { ProfilesService } from '../services/profiles.service'
import { ConfigService } from '../services/config.service'
import { PartialProfile, Profile } from '../api/profileProvider'
import { BaseComponent } from './base.component'

/** @hidden */
@Component({
    selector: 'start-page',
    templateUrl: './startPage.component.pug',
    styleUrls: ['./startPage.component.scss'],
})
export class StartPageComponent extends BaseComponent {
    savedProfiles: PartialProfile<Profile>[] = []
    recentProfiles: PartialProfile<Profile>[] = []
    canStartLocal = false

    constructor (
        public homeBase: HomeBaseService,
        public commands: CommandService,
        public profiles: ProfilesService,
        private config: ConfigService,
    ) { super() }

    ngOnInit (): void {
        this.loadProfiles()
        this.subscribeUntilDestroyed(this.config.changed$, () => this.loadProfiles())
        this.commands.getCommands({}).then(commands => {
            this.canStartLocal = commands.some(c => c.id === 'local:new-tab')
        })
    }

    private async loadProfiles (): Promise<void> {
        this.savedProfiles = (await this.profiles.getProfiles({ includeBuiltin: false })).filter(p => !p.isTemplate && !this.config.store.profileBlacklist.includes(p.id))
        this.recentProfiles = this.profiles.getRecentProfiles().filter(p => !this.config.store.profileBlacklist.includes(p.id))
    }

    async launch (profile: PartialProfile<Profile>): Promise<void> {
        const current = (await this.profiles.getProfiles()).find(p => p.id === profile.id) ?? profile
        await this.profiles.launchProfile(current)
    }
}
