/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Component, Input, ElementRef, ViewChild } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'

/** @hidden */
@Component({
    selector: 'rename-tab-modal',
    templateUrl: './renameTabModal.component.pug',
})
export class RenameTabModalComponent {
    @Input() value: string
    @Input() title: string|undefined
    @Input() requireNonEmpty = false
    @ViewChild('input') input: ElementRef

    constructor (
        private modalInstance: NgbActiveModal,
    ) { }

    ngOnInit () {
        setTimeout(() => {
            this.input.nativeElement.focus()
            this.input.nativeElement.select()
        }, 250)
    }

    save () {
        if (this.requireNonEmpty) {
            this.value = this.value.trim()
            if (!this.value) { return }
        }
        this.modalInstance.close(this.value)
    }

    close () {
        this.modalInstance.dismiss()
    }
}
