import { Injectable } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { AppService, Command, CommandProvider, ConfigService, ProfilesService, SelectorService, TranslateService, PartialProfile, Profile } from 'tabby-core'
import deepClone from 'clone-deep'
import { EditProfileModalComponent } from './components/editProfileModal.component'
import { SettingsTabComponent } from './components/settingsTab.component'

/** @hidden */
@Injectable()
export class SettingsCommandProvider extends CommandProvider {
    constructor (
        private app: AppService,
        private config: ConfigService,
        private profiles: ProfilesService,
        private selector: SelectorService,
        private translate: TranslateService,
        private modal: NgbModal,
    ) { super() }

    async provide (): Promise<Command[]> {
        return [
            { id: 'settings:new-profile', label: this.translate.instant('New session'), run: () => this.newProfile() },
            { id: 'settings:profiles', label: this.translate.instant('Manage sessions'), run: async () => this.openProfiles() },
        ]
    }

    private openProfiles (): void {
        const existing = this.app.tabs.find(t => t instanceof SettingsTabComponent)
        if (existing instanceof SettingsTabComponent) {
            existing.activeTab = 'profiles'
            this.app.selectTab(existing)
        } else {
            this.app.openNewTabRaw({ type: SettingsTabComponent, inputs: { activeTab: 'profiles' } })
        }
    }

    private async newProfile (): Promise<void> {
        const templates = (await this.profiles.getProfiles()).filter(p => p.isTemplate && !this.config.store.profileBlacklist.includes(p.id))
        const base = await this.selector.show<PartialProfile<Profile>>(
            this.translate.instant('New session'),
            templates.map(profile => ({ name: profile.name, icon: profile.icon ?? undefined, result: profile })),
        ).catch(() => null)
        if (!base) { return }
        const provider = this.profiles.providerForProfile(base)
        if (!provider) { return }
        const partial = deepClone(base)
        delete partial.id
        partial.name = ''
        partial.isBuiltin = false
        partial.isTemplate = false
        const dialog = this.modal.open(EditProfileModalComponent, { size: 'lg' })
        dialog.componentInstance.partialProfile = partial
        dialog.componentInstance.profileProvider = provider
        const result: PartialProfile<Profile>|null = await dialog.result.catch(() => null)
        if (!result) { return }
        result.type = provider.id
        result.name ||= provider.getSuggestedName(this.profiles.getConfigProxyForProfile(result)) ?? provider.name
        await this.profiles.newProfile(result)
        await this.config.save()
    }
}
